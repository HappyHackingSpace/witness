import { sha256 } from "../shared/index.js";
import { SKIP_URL_PATTERNS, STORAGE_KEYS } from "../shared/index.js";
import type { DomainRule, SelectorHit } from "../shared/index.js";
import { captureStore } from "../lib/store.js";
import { requestTimestamp } from "../lib/rfc3161.js";
import { detectPatterns } from "../lib/smart-selectors.js";
import { indexCapture, deleteSearchIndex } from "../lib/search.js";

type CaptureMode = "all" | "allowlist" | "blocklist";

const MAX_SCREENSHOT_HEIGHT = 16384;

export default defineBackground(() => {
  console.log("[Witness] Service worker started");

  // Track capture state
  let captureEnabled = false;
  let activeCaseId: string | null = null;
  let lastHash: string | null = null;
  let captureMode: CaptureMode = "all";
  let domainRules: DomainRule[] = [];
  let fullpageScreenshot = false;
  let smartDetection = true;

  // Deduplication: track in-flight + recently captured URLs per tab
  const captureInFlight = new Set<string>(); // "tabId:url" keys currently being captured
  const capturedRecently = new Map<string, number>(); // "tabId:url" -> timestamp
  const DEDUP_COOLDOWN_MS = 5000;

  function shouldCapture(tabId: number, url: string): boolean {
    const key = `${tabId}:${url}`;

    // Already capturing this exact tab+url
    if (captureInFlight.has(key)) return false;

    // Recently captured this exact tab+url
    const lastTime = capturedRecently.get(key);
    if (lastTime && Date.now() - lastTime < DEDUP_COOLDOWN_MS) return false;

    // Mark as in-flight
    captureInFlight.add(key);
    return true;
  }

  function captureFinished(tabId: number, url: string) {
    const key = `${tabId}:${url}`;
    captureInFlight.delete(key);
    capturedRecently.set(key, Date.now());

    // Cleanup old entries
    const now = Date.now();
    for (const [k, t] of capturedRecently) {
      if (now - t > DEDUP_COOLDOWN_MS * 2) capturedRecently.delete(k);
    }
  }

  // Load state from storage on startup, auto-create default case if needed
  chrome.storage.local.get(
    [STORAGE_KEYS.CAPTURE_ENABLED, STORAGE_KEYS.ACTIVE_CASE, STORAGE_KEYS.LAST_HASH, STORAGE_KEYS.DOMAIN_RULES, STORAGE_KEYS.CAPTURE_MODE, STORAGE_KEYS.FULLPAGE_SCREENSHOT, STORAGE_KEYS.SMART_DETECTION],
    async (result) => {
      captureEnabled = result[STORAGE_KEYS.CAPTURE_ENABLED] ?? false;
      activeCaseId = result[STORAGE_KEYS.ACTIVE_CASE] ?? null;
      lastHash = result[STORAGE_KEYS.LAST_HASH] ?? null;
      domainRules = result[STORAGE_KEYS.DOMAIN_RULES] ?? [];
      captureMode = result[STORAGE_KEYS.CAPTURE_MODE] ?? "all";
      fullpageScreenshot = result[STORAGE_KEYS.FULLPAGE_SCREENSHOT] ?? false;
      smartDetection = result[STORAGE_KEYS.SMART_DETECTION] ?? true;

      if (!activeCaseId) {
        const defaultCaseId = crypto.randomUUID();
        await captureStore.createCase({
          id: defaultCaseId,
          name: "Default Case",
          description: "Auto-created default investigation case",
          investigator: "",
          caseNumber: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: [],
          captureCount: 0,
          storageUsed: 0,
        });
        activeCaseId = defaultCaseId;
        await chrome.storage.local.set({
          [STORAGE_KEYS.ACTIVE_CASE]: activeCaseId,
        });
        console.log("[Witness] Created default case:", defaultCaseId);
      }

      updateIcon();
    }
  );

  function matchesDomainPattern(hostname: string, pattern: string): boolean {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return hostname === suffix || hostname.endsWith("." + suffix);
    }
    return hostname === pattern;
  }

  function isDomainAllowed(url: string): boolean {
    if (captureMode === "all") return true;

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return false;
    }

    if (captureMode === "allowlist") {
      return domainRules.some(
        (rule) => rule.action === "allow" && matchesDomainPattern(hostname, rule.pattern)
      );
    }

    if (captureMode === "blocklist") {
      return !domainRules.some(
        (rule) => rule.action === "block" && matchesDomainPattern(hostname, rule.pattern)
      );
    }

    return true;
  }

  // Shared capture handler with dedup guard
  async function handleNavigation(tabId: number, url: string) {
    if (!captureEnabled || !activeCaseId) return;
    if (shouldSkipUrl(url)) return;
    if (!isDomainAllowed(url)) return;
    if (!shouldCapture(tabId, url)) return;

    try {
      await captureCurrentPage(tabId, url);
    } catch (err) {
      console.error("[Witness] Capture failed:", err);
    } finally {
      captureFinished(tabId, url);
    }
  }

  // Listen for navigation completions (main frame only)
  chrome.webNavigation.onCompleted.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      handleNavigation(details.tabId, details.url);
    },
    { url: [{ schemes: ["http", "https"] }] }
  );

  // SPA navigation detection (pushState/replaceState)
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      handleNavigation(details.tabId, details.url);
    },
    { url: [{ schemes: ["http", "https"] }] }
  );

  // Handle messages from side panel, content scripts, popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true; // Keep channel open for async response
  });

  // Open side panel on extension icon click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Right-click context menu
  chrome.contextMenus.create({
    id: "witness-capture",
    title: "Capture this page",
    contexts: ["page"],
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "witness-capture" && tab?.id && tab.url) {
      await captureCurrentPage(tab.id, tab.url);
    }
  });

  function cdp(tabId: number, method: string, params?: any): Promise<any> {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return btoa(binary);
  }

  async function captureFullPageScreenshot(tabId: number): Promise<string | null> {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");

      const metrics = await cdp(tabId, "Page.getLayoutMetrics");
      const contentWidth = metrics.cssContentSize?.width ?? metrics.contentSize.width;
      const scrollHeight = metrics.cssContentSize?.height ?? metrics.contentSize.height;
      const vpHeight = metrics.cssVisualViewport?.clientHeight ?? metrics.cssLayoutViewport?.clientHeight;
      const vpWidth = metrics.cssVisualViewport?.clientWidth ?? metrics.cssLayoutViewport?.clientWidth;
      const cappedHeight = Math.min(Math.ceil(scrollHeight), MAX_SCREENSHOT_HEIGHT);
      const dpr = metrics.cssVisualViewport?.pageScaleFactor ?? 1;

      if (cappedHeight <= vpHeight) {
        const result = await cdp(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 80 });
        await chrome.debugger.detach({ tabId });
        return `data:image/jpeg;base64,${result.data}`;
      }

      console.log(`[Witness] Full-page: scroll=${scrollHeight}, viewport=${vpHeight}, capped=${cappedHeight}`);

      // Hide fixed/sticky elements (they repeat in every clip region)
      await cdp(tabId, "Runtime.evaluate", {
        expression: `(function(){
          const s=document.createElement('style');
          s.id='__witness_ss';
          s.textContent='[data-witness-fixed]{visibility:hidden!important}';
          document.head.appendChild(s);
          document.querySelectorAll('*').forEach(el=>{
            const cs=getComputedStyle(el);
            if(cs.position==='fixed'||cs.position==='sticky'){
              el.setAttribute('data-witness-fixed','1');
            }
          });
        })()`,
      });
      await delay(50);

      // Capture tiles using clip regions (no scrolling!)
      const tiles: { base64: string; y: number; h: number }[] = [];
      for (let y = 0; y < cappedHeight; y += vpHeight) {
        const h = Math.min(vpHeight, cappedHeight - y);
        const result = await cdp(tabId, "Page.captureScreenshot", {
          format: "jpeg",
          quality: 80,
          clip: { x: 0, y, width: vpWidth, height: h, scale: dpr },
          captureBeyondViewport: true,
        });
        tiles.push({ base64: result.data, y, h });
      }

      // Capture first tile again WITH fixed elements visible (nav/header)
      await cdp(tabId, "Runtime.evaluate", {
        expression: `document.querySelectorAll('[data-witness-fixed]').forEach(el=>el.removeAttribute('data-witness-fixed'))`,
      });
      await delay(50);
      const navTile = await cdp(tabId, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 80,
        clip: { x: 0, y: 0, width: vpWidth, height: Math.min(vpHeight, cappedHeight), scale: dpr },
        captureBeyondViewport: true,
      });

      // Cleanup
      await cdp(tabId, "Runtime.evaluate", {
        expression: `document.getElementById('__witness_ss')?.remove()`,
      });
      await chrome.debugger.detach({ tabId });

      // Stitch tiles using OffscreenCanvas
      const firstBlob = await (await fetch(`data:image/jpeg;base64,${navTile.data}`)).blob();
      const firstBmp = await createImageBitmap(firstBlob);
      const pixelWidth = firstBmp.width;
      const scale = firstBmp.height / Math.min(vpHeight, cappedHeight);
      firstBmp.close();

      const canvas = new OffscreenCanvas(pixelWidth, Math.ceil(cappedHeight * scale));
      const ctx = canvas.getContext("2d")!;

      // Draw first tile with nav visible
      const navBlob = await (await fetch(`data:image/jpeg;base64,${navTile.data}`)).blob();
      const navBmp = await createImageBitmap(navBlob);
      ctx.drawImage(navBmp, 0, 0);
      navBmp.close();

      // Draw remaining tiles (without fixed elements) over the rest
      for (let i = 1; i < tiles.length; i++) {
        const tile = tiles[i];
        const blob = await (await fetch(`data:image/jpeg;base64,${tile.base64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const dstY = Math.round(tile.y * scale);
        ctx.drawImage(bmp, 0, dstY);
        bmp.close();
      }

      const resultBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
      const resultBuffer = await resultBlob.arrayBuffer();
      const resultBase64 = arrayBufferToBase64(resultBuffer);
      return `data:image/jpeg;base64,${resultBase64}`;
    } catch (err) {
      try { await chrome.debugger.detach({ tabId }); } catch {}
      console.error("[Witness] Full-page screenshot failed:", err);
      return null;
    }
  }

  async function captureCurrentPage(tabId: number, url: string): Promise<void> {
    const timestamp = new Date().toISOString();

    // Get page info via content script
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        html: document.documentElement.outerHTML,
      }),
      world: "ISOLATED",
    });

    const pageInfo = result?.result ?? { title: url, html: "" };

    // Scan for selector matches
    let selectorHits: SelectorHit[] = [];
    try {
      const selectors = await captureStore.getSelectors(activeCaseId ?? undefined);
      if (selectors.length > 0) {
        const scanResponse = await chrome.tabs.sendMessage(tabId, {
          type: "SCAN_SELECTORS",
          payload: { selectors },
        });
        if (scanResponse?.hits?.length > 0) {
          selectorHits = scanResponse.hits;
          // Update hit counts in store
          const hitCounts = new Map<string, number>();
          for (const hit of selectorHits) {
            hitCounts.set(hit.selectorId, (hitCounts.get(hit.selectorId) ?? 0) + 1);
          }
          for (const sel of selectors) {
            const newHits = hitCounts.get(sel.id);
            if (newHits) {
              await captureStore.saveSelector({ ...sel, hitCount: sel.hitCount + newHits });
            }
          }
          console.log(`[Witness] Selector hits: ${selectorHits.length} on ${url}`);
        }
      }
    } catch {
      // Content script may not be injected yet
    }

    // Smart pattern detection on page content (if enabled)
    if (smartDetection) {
      try {
        const smartMatches = detectPatterns(pageInfo.html);
        if (smartMatches.length > 0) {
          const smartHits: SelectorHit[] = smartMatches.map((m) => ({
            selectorId: "auto",
            selectorName: `Auto: ${m.type}`,
            matchedText: m.value,
            context: m.context,
            location: "visible" as const,
          }));
          selectorHits = selectorHits.concat(smartHits);
          console.log(`[Witness] Smart matches: ${smartMatches.length} on ${url}`);
        }
      } catch (err) {
        console.warn("[Witness] Smart pattern detection failed:", err);
      }
    }

    // Capture MHTML (with fallback to DOM serialization)
    let mhtmlBuffer: ArrayBuffer;
    let format: "mhtml" | "dom-html" = "mhtml";
    try {
      const mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId });
      mhtmlBuffer = await mhtmlBlob.arrayBuffer();
    } catch (mhtmlErr) {
      console.warn("[Witness] MHTML capture failed, falling back to DOM serialization:", mhtmlErr);
      const encoder = new TextEncoder();
      mhtmlBuffer = encoder.encode(pageInfo.html).buffer as ArrayBuffer;
      format = "dom-html";
    }

    // Compute hashes
    const contentHash = await sha256(mhtmlBuffer);

    // Take screenshot (full-page or viewport)
    let screenshotHash: string | null = null;
    let screenshotDataUrl: string | null = null;
    try {
      console.log(`[Witness] Screenshot mode: ${fullpageScreenshot ? "full-page" : "viewport"}`);
      if (fullpageScreenshot) {
        screenshotDataUrl = await captureFullPageScreenshot(tabId);
        // Fall back to viewport if full-page fails
        if (!screenshotDataUrl) {
          screenshotDataUrl = await chrome.tabs.captureVisibleTab(undefined, {
            format: "png",
            quality: 100,
          });
        }
      } else {
        screenshotDataUrl = await chrome.tabs.captureVisibleTab(undefined, {
          format: "png",
          quality: 100,
        });
      }
      if (screenshotDataUrl) {
        const screenshotData = dataUrlToArrayBuffer(screenshotDataUrl);
        screenshotHash = await sha256(screenshotData);
      }
    } catch {
      // Screenshot may fail (e.g., chrome:// pages)
    }

    // Build capture metadata
    const captureId = crypto.randomUUID();
    const metadataJson = JSON.stringify({
      id: captureId,
      url,
      title: pageInfo.title,
      timestamp,
      caseId: activeCaseId,
    });

    const { computeEvidenceHash } = await import("../shared/index.js");
    const evidenceHash = await computeEvidenceHash(
      contentHash,
      screenshotHash,
      metadataJson,
      lastHash
    );

    // Store capture immediately (timestamp will be added async)
    await captureStore.saveCapture({
      id: captureId,
      url,
      title: pageInfo.title,
      timestamp,
      contentHash,
      screenshotHash,
      evidenceHash,
      previousHash: lastHash,
      statusCode: null,
      contentType: null,
      responseHeaders: {},
      certificate: null,
      browser: {
        userAgent: navigator.userAgent,
        name: "Chrome",
        version: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "unknown",
        platform: navigator.platform,
        viewport: { width: 0, height: 0 },
      },
      referrer: null,
      caseId: activeCaseId!,
      tags: [],
      notes: "",
      selectorHits,
      rfc3161Token: null,
      format,
      contentSize: mhtmlBuffer.byteLength,
    }, mhtmlBuffer, screenshotDataUrl);

    // Update hash chain
    lastHash = evidenceHash;
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_HASH]: lastHash });

    // Update badge — highlight selector hits
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.id) {
        const badgeText = selectorHits.length > 0 ? `${selectorHits.length}` : "OK";
        const badgeColor = selectorHits.length > 0 ? "#f59e0b" : "#10b981";
        chrome.action.setBadgeText({ text: badgeText, tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tab.id });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: "", tabId: tab.id! });
        }, selectorHits.length > 0 ? 5000 : 2000);
      }
    } catch {
      // Tab may have been closed during capture
    }

    // Notify side panel / popup
    chrome.runtime.sendMessage({
      type: "CAPTURE_COMPLETE",
      payload: {
        id: captureId,
        url,
        title: pageInfo.title,
        timestamp,
        contentHash,
        screenshotHash,
        evidenceHash,
        previousHash: lastHash,
        contentSize: mhtmlBuffer.byteLength,
        caseId: activeCaseId,
        tags: [],
        notes: "",
        selectorHits,
      },
    }).catch(() => {
      // No listener available (side panel closed) — ignore
    });

    console.log(`[Witness] Captured: ${url} (${contentHash.slice(0, 8)}...)`);

    // Index page text for full-text search (non-blocking)
    try {
      const plainText = pageInfo.html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100000);
      indexCapture(captureId, url, pageInfo.title, plainText, timestamp, activeCaseId ?? "").catch(() => {});
    } catch { /* ignore indexing errors */ }

    // Request RFC 3161 trusted timestamp in background (doesn't block capture)
    requestTimestamp(evidenceHash).then(async (token) => {
      if (token) {
        await captureStore.updateCapture(captureId, { rfc3161Token: token });
        console.log(`[Witness] RFC 3161 timestamp stored for ${captureId}`);
      }
    }).catch((err) => {
      console.warn("[Witness] RFC 3161 timestamp request failed:", err);
    });
  }

  async function handleMessage(message: { type: string; payload?: unknown }) {
    switch (message.type) {
      case "GET_STATUS":
        return {
          captureEnabled,
          activeCaseId,
          lastHash,
        };

      case "TOGGLE_CAPTURE":
        captureEnabled = !captureEnabled;
        await chrome.storage.local.set({
          [STORAGE_KEYS.CAPTURE_ENABLED]: captureEnabled,
        });
        updateIcon();
        chrome.runtime.sendMessage({
          type: "CAPTURE_STATE_CHANGED",
          payload: { captureEnabled },
        }).catch(() => {});
        return { captureEnabled };

      case "SET_ACTIVE_CASE":
        activeCaseId = (message.payload as { caseId: string }).caseId;
        await chrome.storage.local.set({
          [STORAGE_KEYS.ACTIVE_CASE]: activeCaseId,
        });
        return { activeCaseId };

      case "DELETE_CAPTURE": {
        const { captureId } = message.payload as { captureId: string };
        await captureStore.deleteCapture(captureId);
        deleteSearchIndex(captureId).catch(() => {});
        return { success: true };
      }

      case "GET_DOMAIN_RULES":
        return { rules: domainRules, mode: captureMode };

      case "SAVE_DOMAIN_RULE": {
        const { pattern, action } = message.payload as { pattern: string; action: "allow" | "block" };
        const exists = domainRules.some((r) => r.pattern === pattern && r.action === action);
        if (!exists) {
          domainRules.push({ pattern, action });
          await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_RULES]: domainRules });
        }
        return { rules: domainRules };
      }

      case "DELETE_DOMAIN_RULE": {
        const { pattern: delPattern, action: delAction } = message.payload as { pattern: string; action: "allow" | "block" };
        domainRules = domainRules.filter((r) => !(r.pattern === delPattern && r.action === delAction));
        await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_RULES]: domainRules });
        return { rules: domainRules };
      }

      case "SET_CAPTURE_MODE": {
        captureMode = (message.payload as { mode: CaptureMode }).mode;
        await chrome.storage.local.set({ [STORAGE_KEYS.CAPTURE_MODE]: captureMode });
        return { mode: captureMode };
      }

      case "UPDATE_CAPTURE": {
        const { captureId: updateId, updates } = message.payload as {
          captureId: string;
          updates: { tags?: string[]; notes?: string };
        };
        await captureStore.updateCapture(updateId, updates);
        return { success: true };
      }

      case "CAPTURE_CURRENT":
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id && tab.url) {
          await captureCurrentPage(tab.id, tab.url);
          return { success: true };
        }
        return { success: false, error: "No active tab" };

      case "GET_SETTINGS":
        return {
          fullpageScreenshot,
          smartDetection,
        };

      case "SET_FULLPAGE_SCREENSHOT": {
        fullpageScreenshot = (message.payload as { enabled: boolean }).enabled;
        await chrome.storage.local.set({
          [STORAGE_KEYS.FULLPAGE_SCREENSHOT]: fullpageScreenshot,
        });
        return { fullpageScreenshot };
      }

      case "SET_SMART_DETECTION": {
        smartDetection = (message.payload as { enabled: boolean }).enabled;
        await chrome.storage.local.set({
          [STORAGE_KEYS.SMART_DETECTION]: smartDetection,
        });
        return { smartDetection };
      }

      default:
        return { error: "Unknown message type" };
    }
  }

  function updateIcon() {
    const path = captureEnabled
      ? {
          16: "icons/icon-active-16.png",
          32: "icons/icon-active-32.png",
          48: "icons/icon-active-48.png",
          128: "icons/icon-active-128.png",
        }
      : {
          16: "icons/icon-16.png",
          32: "icons/icon-32.png",
          48: "icons/icon-48.png",
          128: "icons/icon-128.png",
        };
    chrome.action.setIcon({ path });
    chrome.action.setTitle({
      title: captureEnabled ? "Witness (Capturing)" : "Witness (Paused)",
    });
  }

  function shouldSkipUrl(url: string): boolean {
    return SKIP_URL_PATTERNS.some((pattern) => pattern.test(url));
  }

  function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer as ArrayBuffer;
  }
});

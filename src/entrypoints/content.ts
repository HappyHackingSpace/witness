import { SELECTOR_CONTEXT_CHARS } from "../shared/index.js";
import type { SelectorHit, Selector } from "../shared/index.js";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    // Listen for selector scan requests from background
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "SCAN_SELECTORS") {
        const hits = scanSelectors(message.payload.selectors);
        sendResponse({ hits });
      }

      if (message.type === "EXTRACT_PAGE_DATA") {
        const data = extractPageData();
        sendResponse({ data });
      }

      return true;
    });
  },
});

/**
 * Scan the full HTML source for selector matches.
 * Searches visible text AND raw HTML source (catches hidden metadata, JS vars).
 */
function scanSelectors(selectors: Selector[]): SelectorHit[] {
  const hits: SelectorHit[] = [];
  const html = document.documentElement.outerHTML;
  const visibleText = document.body?.innerText ?? "";

  for (const selector of selectors) {
    if (!selector.enabled) continue;

    const pattern = selector.isRegex
      ? new RegExp(selector.pattern, "gi")
      : new RegExp(escapeRegex(selector.pattern), "gi");

    // Scan HTML source
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const start = Math.max(0, match.index - SELECTOR_CONTEXT_CHARS);
      const end = Math.min(html.length, match.index + match[0].length + SELECTOR_CONTEXT_CHARS);
      const context = html.slice(start, end);

      const isVisible = visibleText.includes(match[0]);

      hits.push({
        selectorId: selector.id,
        selectorName: selector.name,
        matchedText: match[0],
        context: sanitizeContext(context),
        location: isVisible ? "visible" : "source",
      });

      // Limit hits per selector to prevent runaway matches
      if (hits.filter((h) => h.selectorId === selector.id).length >= 100) break;
    }
  }

  return hits;
}

/**
 * Extract structured page data for metadata collection.
 */
function extractPageData() {
  return {
    title: document.title,
    url: window.location.href,
    canonicalUrl: getMetaContent("canonical") ?? getLinkHref("canonical"),
    description: getMetaContent("description"),
    author: getMetaContent("author"),
    keywords: getMetaContent("keywords"),
    ogTitle: getMetaContent("og:title"),
    ogDescription: getMetaContent("og:description"),
    ogImage: getMetaContent("og:image"),
    ogUrl: getMetaContent("og:url"),
    ogSiteName: getMetaContent("og:site_name"),
    twitterCard: getMetaContent("twitter:card"),
    twitterSite: getMetaContent("twitter:site"),
    twitterCreator: getMetaContent("twitter:creator"),
    language: document.documentElement.lang || null,
    charset: document.characterSet,
    linkCount: document.querySelectorAll("a[href]").length,
    imageCount: document.querySelectorAll("img").length,
    formCount: document.querySelectorAll("form").length,
    scriptCount: document.querySelectorAll("script").length,
    frameCount: document.querySelectorAll("iframe, frame").length,
  };
}

function getMetaContent(name: string): string | null {
  const el =
    document.querySelector(`meta[name="${name}"]`) ??
    document.querySelector(`meta[property="${name}"]`);
  return el?.getAttribute("content") ?? null;
}

function getLinkHref(rel: string): string | null {
  const el = document.querySelector(`link[rel="${rel}"]`);
  return el?.getAttribute("href") ?? null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeContext(context: string): string {
  // Strip script tags and their content from context
  return context.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "[script]");
}

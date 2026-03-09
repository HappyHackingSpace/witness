<script lang="ts">
  import type { DomainRule, CaptureMetadata } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";
  import { exportAll as exportAllZip, exportAllWarc } from "../lib/export.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ReportBuilder from "./ReportBuilder.svelte";

  type CaptureMode = "all" | "allowlist" | "blocklist";

  let totalCaptures = $state(0);
  let totalSize = $state(0);
  let chainValid = $state<boolean | null>(null);
  let verifying = $state(false);
  let exporting = $state(false);
  let confirmVisible = $state(false);
  let confirmAction = $state<(() => void) | null>(null);
  let confirmMsg = $state("");
  let confirmTitle = $state("");

  let captureMode = $state<CaptureMode>("all");
  let domainRules = $state<DomainRule[]>([]);
  let newPattern = $state("");
  let fullpageScreenshot = $state(false);
  let smartDetection = $state(true);

  export async function load() {
    const stats = await captureStore.getStats();
    totalCaptures = stats.totalCaptures;
    // Estimate storage
    const captures = await captureStore.getRecentCaptures(9999);
    totalSize = captures.reduce((sum, c) => sum + c.contentSize, 0);

    // Load domain rules
    const rulesResponse = await chrome.runtime.sendMessage({ type: "GET_DOMAIN_RULES" });
    if (rulesResponse) {
      domainRules = rulesResponse.rules ?? [];
      captureMode = rulesResponse.mode ?? "all";
    }

    // Load settings
    const settingsResponse = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (settingsResponse) {
      fullpageScreenshot = settingsResponse.fullpageScreenshot ?? false;
      smartDetection = settingsResponse.smartDetection ?? true;
    }
  }

  async function setCaptureMode(mode: CaptureMode) {
    captureMode = mode;
    await chrome.runtime.sendMessage({ type: "SET_CAPTURE_MODE", payload: { mode } });
  }

  async function addRule() {
    const pattern = newPattern.trim();
    if (!pattern) return;
    const action = captureMode === "blocklist" ? "block" as const : "allow" as const;
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_DOMAIN_RULE",
      payload: { pattern, action },
    });
    if (response?.rules) {
      domainRules = response.rules;
    }
    newPattern = "";
  }

  async function deleteRule(rule: DomainRule) {
    const response = await chrome.runtime.sendMessage({
      type: "DELETE_DOMAIN_RULE",
      payload: { pattern: rule.pattern, action: rule.action },
    });
    if (response?.rules) {
      domainRules = response.rules;
    }
  }

  async function toggleFullpageScreenshot() {
    fullpageScreenshot = !fullpageScreenshot;
    await chrome.runtime.sendMessage({
      type: "SET_FULLPAGE_SCREENSHOT",
      payload: { enabled: fullpageScreenshot },
    });
  }

  async function toggleSmartDetection() {
    smartDetection = !smartDetection;
    await chrome.runtime.sendMessage({
      type: "SET_SMART_DETECTION",
      payload: { enabled: smartDetection },
    });
  }

  function getModeDescription(mode: CaptureMode): string {
    switch (mode) {
      case "all": return "Capture all pages regardless of domain.";
      case "allowlist": return "Only capture pages from domains in the allow list.";
      case "blocklist": return "Capture all pages except those from blocked domains.";
    }
  }

  async function verifyChain() {
    verifying = true;
    chainValid = null;
    try {
      const { sha256, computeEvidenceHash } = await import("../shared/index.js");
      const captures = await captureStore.getRecentCaptures(9999);
      // Sort oldest first
      captures.reverse();
      let valid = true;
      for (let i = 0; i < captures.length; i++) {
        const cap = captures[i];
        const mhtml = await captureStore.getCaptureBlob(cap.id, "mhtml");
        if (!mhtml || typeof mhtml === "string") continue;

        const contentHash = await sha256(mhtml);
        if (contentHash !== cap.contentHash) {
          valid = false;
          break;
        }

        // Verify evidence hash
        const metadataJson = JSON.stringify({
          id: cap.id,
          url: cap.url,
          title: cap.title,
          timestamp: cap.timestamp,
          caseId: cap.caseId,
        });
        const expectedHash = await computeEvidenceHash(
          cap.contentHash,
          cap.screenshotHash,
          metadataJson,
          cap.previousHash
        );
        if (expectedHash !== cap.evidenceHash) {
          valid = false;
          break;
        }
      }
      chainValid = valid;
    } catch {
      chainValid = false;
    }
    verifying = false;
  }

  let exportFormat = $state<"zip" | "warc" | "report">("zip");
  let showReport = $state(false);
  let reportCaptures = $state<CaptureMetadata[]>([]);

  async function exportAll() {
    if (exportFormat === "report") {
      const captures = await captureStore.getRecentCaptures(9999);
      captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      reportCaptures = captures;
      showReport = true;
      return;
    }
    exporting = true;
    try {
      if (exportFormat === "warc") {
        await exportAllWarc();
      } else {
        await exportAllZip();
      }
    } catch (err) {
      alert("Export failed: " + err);
    }
    exporting = false;
  }

  function clearAll() {
    confirmTitle = "Delete All Data";
    confirmMsg = "Delete ALL captures, cases, and selectors? This action is permanent and cannot be undone.";
    confirmAction = async () => {
      const captures = await captureStore.getRecentCaptures(9999);
      for (const cap of captures) {
        await captureStore.deleteCapture(cap.id);
      }
      const cases = await captureStore.getAllCases();
      for (const c of cases) {
        await captureStore.deleteCase(c.id);
      }
      const selectors = await captureStore.getSelectors();
      for (const s of selectors) {
        await captureStore.deleteSelector(s.id);
      }

      await chrome.storage.local.remove("witness_last_hash");

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await captureStore.createCase({
        id, name: "Default Case", description: "Auto-created default investigation case",
        investigator: "", caseNumber: "", createdAt: now, updatedAt: now,
        tags: [], captureCount: 0, storageUsed: 0,
      });
      await chrome.runtime.sendMessage({ type: "SET_ACTIVE_CASE", payload: { caseId: id } });

      await load();
    };
    confirmVisible = true;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  load();
</script>

<div class="settings-view">
  <div class="view-header">
    <h2>Settings</h2>
  </div>

  <!-- Capture Rules -->
  <div class="settings-section">
    <h3>Capture Rules</h3>
    <p class="section-desc">{getModeDescription(captureMode)}</p>

    <div class="mode-toggle">
      <button
        class="mode-btn"
        class:active={captureMode === "all"}
        onclick={() => setCaptureMode("all")}
      >All</button>
      <button
        class="mode-btn"
        class:active={captureMode === "allowlist"}
        onclick={() => setCaptureMode("allowlist")}
      >Allowlist</button>
      <button
        class="mode-btn"
        class:active={captureMode === "blocklist"}
        onclick={() => setCaptureMode("blocklist")}
      >Blocklist</button>
    </div>

    {#if captureMode !== "all"}
      <div class="rule-input-row">
        <input
          type="text"
          class="rule-input"
          placeholder="example.com or *.example.com"
          bind:value={newPattern}
          onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") addRule(); }}
        />
        <button class="small-btn" onclick={addRule}>Add</button>
      </div>

      {#if domainRules.filter((r) => captureMode === "blocklist" ? r.action === "block" : r.action === "allow").length === 0}
        <p class="section-desc" style="margin-top: 8px; margin-bottom: 0;">No domain rules configured.</p>
      {:else}
        <div class="rule-list">
          {#each domainRules.filter((r) => captureMode === "blocklist" ? r.action === "block" : r.action === "allow") as rule}
            <div class="rule-item">
              <code class="rule-pattern">{rule.pattern}</code>
              <button class="small-btn danger" onclick={() => deleteRule(rule)}>Remove</button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="toggle-row" style="margin-top: 12px;">
      <label class="toggle-label">
        <input
          type="checkbox"
          checked={fullpageScreenshot}
          onchange={toggleFullpageScreenshot}
        />
        <span class="toggle-text">
          <strong>Full-page screenshots</strong>
          <span class="toggle-desc">Capture the entire scrollable page via DevTools Protocol. A brief debug banner may appear during capture.</span>
        </span>
      </label>
    </div>

    <div class="toggle-row" style="margin-top: 8px;">
      <label class="toggle-label">
        <input
          type="checkbox"
          checked={smartDetection}
          onchange={toggleSmartDetection}
        />
        <span class="toggle-text">
          <strong>Smart detection</strong>
          <span class="toggle-desc">Auto-detect emails, phone numbers, crypto addresses, IPs, and social handles on captured pages.</span>
        </span>
      </label>
    </div>
  </div>

  <!-- Storage -->
  <div class="settings-section">
    <h3>Storage</h3>
    <div class="info-row">
      <span>Total captures</span>
      <span>{totalCaptures}</span>
    </div>
    <div class="info-row">
      <span>Estimated size</span>
      <span>{formatSize(totalSize)}</span>
    </div>
  </div>

  <!-- Verification -->
  <div class="settings-section">
    <h3>Evidence Integrity</h3>
    <p class="section-desc">Verify that no captures have been tampered with by checking content hashes and the evidence chain.</p>
    <button class="action-btn" onclick={verifyChain} disabled={verifying}>
      {verifying ? "Verifying..." : "Verify Evidence Chain"}
    </button>
    {#if chainValid !== null}
      <div class="verify-result" class:valid={chainValid} class:invalid={!chainValid}>
        {chainValid ? "All evidence verified. Chain is intact." : "Verification failed. Evidence may have been tampered with."}
      </div>
    {/if}
  </div>

  <!-- Export -->
  <div class="settings-section">
    <h3>Export</h3>
    <p class="section-desc">Download all data as a ZIP, WARC, or HTML/PDF report. WARC (ISO 28500) is the standard web archive format accepted by courts and archives.</p>
    <div class="mode-toggle">
      <button class="mode-btn" class:active={exportFormat === "zip"} onclick={() => (exportFormat = "zip")}>ZIP</button>
      <button class="mode-btn" class:active={exportFormat === "warc"} onclick={() => (exportFormat = "warc")}>WARC</button>
      <button class="mode-btn" class:active={exportFormat === "report"} onclick={() => (exportFormat = "report")}>Report</button>
    </div>
    <button class="action-btn" onclick={exportAll} disabled={exporting} style="margin-top: 8px;">
      {exporting ? "Exporting..." : exportFormat === "report" ? "Generate Report" : `Export All (${exportFormat.toUpperCase()})`}
    </button>
  </div>

  <!-- Danger Zone -->
  <div class="settings-section danger-zone">
    <h3>Danger Zone</h3>
    <button class="action-btn danger" onclick={clearAll}>Delete All Data</button>
  </div>

  <!-- About -->
  <div class="settings-section">
    <h3>About</h3>
    <div class="info-row">
      <span>Version</span>
      <span>0.1.0</span>
    </div>
    <div class="info-row">
      <span>Built by</span>
      <span>Happy Hacking Space</span>
    </div>
  </div>
</div>

<ConfirmDialog
  bind:visible={confirmVisible}
  title={confirmTitle || "Confirm"}
  message={confirmMsg}
  confirmText="Delete Everything"
  danger={true}
  onConfirm={() => confirmAction?.()}
/>

{#if showReport}
  <ReportBuilder
    captures={reportCaptures}
    onClose={() => (showReport = false)}
  />
{/if}

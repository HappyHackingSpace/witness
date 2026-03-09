<script lang="ts">
  import type { CaptureMetadata, Case } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";
  import { generateReport, type ReportCapture } from "../lib/report.js";

  let {
    captures,
    caseInfo,
    onClose,
  }: {
    captures: CaptureMetadata[];
    caseInfo?: Case;
    onClose: () => void;
  } = $props();

  let title = $state(caseInfo ? `${caseInfo.name} — Evidence Report` : "Evidence Report");
  let investigator = $state("");
  let includeScreenshots = $state(true);
  let includeHashes = $state(true);
  let includeNotes = $state(true);
  let generating = $state(false);

  async function buildHtml(): Promise<string> {
    const items: ReportCapture[] = [];
    for (const cap of captures) {
      let screenshotDataUrl: string | null = null;
      if (includeScreenshots) {
        const data = await captureStore.getCaptureBlob(cap.id, "screenshot");
        if (typeof data === "string") screenshotDataUrl = data;
      }
      items.push({ metadata: cap, screenshotDataUrl });
    }

    return generateReport(items, {
      title,
      caseInfo,
      investigator,
      includeScreenshots,
      includeHashes,
      includeNotes,
    });
  }

  async function downloadHtml() {
    generating = true;
    try {
      const html = await buildHtml();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `witness_report_${date}.html`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      alert("Report generation failed: " + err);
    }
    generating = false;
  }

  async function openPdf() {
    generating = true;
    try {
      const html = await buildHtml();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      // Open in new tab — user can Print > Save as PDF
      window.open(url, "_blank");
      onClose();
    } catch (err) {
      alert("Report generation failed: " + err);
    }
    generating = false;
  }
</script>

<div class="report-builder-overlay" onclick={onClose} onkeydown={(e) => e.key === "Escape" && onClose()} role="button" tabindex="-1">
  <div class="report-builder" onclick={(e) => e.stopPropagation()} role="dialog">
    <h3>Generate Report</h3>
    <p class="builder-desc">{captures.length} evidence item{captures.length !== 1 ? "s" : ""} will be included.</p>

    <label class="builder-field">
      <span>Report Title</span>
      <input type="text" bind:value={title} />
    </label>

    <label class="builder-field">
      <span>Investigator Name</span>
      <input type="text" bind:value={investigator} placeholder="Optional" />
    </label>

    <div class="builder-options">
      <label><input type="checkbox" bind:checked={includeScreenshots} /> Include screenshots</label>
      <label><input type="checkbox" bind:checked={includeHashes} /> Include hashes</label>
      <label><input type="checkbox" bind:checked={includeNotes} /> Include notes</label>
    </div>

    <div class="builder-actions">
      <button class="action-btn" onclick={downloadHtml} disabled={generating || !title.trim()}>
        {generating ? "Generating..." : "Download HTML"}
      </button>
      <button class="action-btn" onclick={openPdf} disabled={generating || !title.trim()}>
        PDF
      </button>
      <button class="small-btn" onclick={onClose}>Cancel</button>
    </div>
  </div>
</div>

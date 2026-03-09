<script lang="ts">
  import type { CaptureMetadata } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";
  import { exportCapture as exportCaptureZip, exportCaptureWarc } from "../lib/export.js";
  import { verifyTimestamp, type TimestampInfo } from "../lib/rfc3161.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ReportBuilder from "./ReportBuilder.svelte";
  import Timeline from "./Timeline.svelte";
  import AnnotationEditor from "./AnnotationEditor.svelte";
  import type { Annotation } from "../lib/annotations.js";
  import { exportAnnotatedScreenshot } from "../lib/annotations.js";
  import { searchContent, type SearchResult } from "../lib/search.js";

  let captures: CaptureMetadata[] = $state([]);
  let filtered: CaptureMetadata[] = $state([]);
  let search = $state("");
  let selectedCapture = $state<CaptureMetadata | null>(null);
  let screenshotUrl = $state<string | null>(null);
  let screenshotFullView = $state(false);
  let tagInput = $state("");
  let notesValue = $state("");
  let timestampInfo = $state<TimestampInfo | null>(null);
  let filterTag = $state<string | null>(null);
  let confirmVisible = $state(false);
  let confirmAction = $state<(() => void) | null>(null);
  let confirmMsg = $state("");
  let selectMode = $state(false);
  let selected = $state<Set<string>>(new Set());
  let showReport = $state(false);
  let reportCaptures = $state<CaptureMetadata[]>([]);
  let viewMode = $state<"list" | "timeline">("list");
  let exportMenuOpen = $state(false);
  let showAnnotationEditor = $state(false);
  let captureAnnotations = $state<Annotation[]>([]);
  let annotatedScreenshotUrl = $state<string | null>(null);
  let contentResults = $state<Map<string, SearchResult>>(new Map());

  // Same-page detection: track revisit counts and content changes per URL
  let urlStats = $state<Map<string, { count: number; titles: Set<string> }>>(new Map());

  export async function load() {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    const activeCaseId = status.activeCaseId ?? null;
    if (activeCaseId) {
      const caseCaptures = await captureStore.getCapturesByCase(activeCaseId);
      caseCaptures.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      captures = caseCaptures;
    } else {
      captures = await captureStore.getRecentCaptures(500);
    }
    computeUrlStats();
    applyFilter();
  }

  export async function viewCaptureById(id: string) {
    // Load all captures to find the target (may be from a different case)
    const allCaptures = await captureStore.getRecentCaptures(500);
    captures = allCaptures;
    applyFilter();
    const cap = captures.find((c) => c.id === id);
    if (cap) viewCapture(cap);
  }

  function normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }

  function computeUrlStats() {
    const stats = new Map<string, { count: number; titles: Set<string> }>();
    for (const cap of captures) {
      const key = normalizeUrl(cap.url);
      const existing = stats.get(key);
      if (existing) {
        existing.count++;
        existing.titles.add(cap.title);
      } else {
        stats.set(key, { count: 1, titles: new Set([cap.title]) });
      }
    }
    urlStats = stats;
  }

  function getRevisitCount(cap: CaptureMetadata): number | null {
    const stat = urlStats.get(normalizeUrl(cap.url));
    if (!stat || stat.count <= 1) return null;
    return stat.count;
  }

  function applyFilter() {
    let result = captures;

    if (filterTag) {
      result = result.filter((c) => c.tags.includes(filterTag!));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      // Metadata match OR content match
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.url.toLowerCase().includes(q) ||
          c.contentHash.includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)) ||
          contentResults.has(c.id)
      );
    }

    filtered = result;
  }

  function getContentSnippet(captureId: string): string | null {
    const result = contentResults.get(captureId);
    return result?.snippets[0] ?? null;
  }

  function getAllTags(): string[] {
    const tagSet = new Set<string>();
    for (const cap of captures) {
      for (const tag of cap.tags) tagSet.add(tag);
    }
    return [...tagSet].sort();
  }

  async function viewCapture(cap: CaptureMetadata) {
    selectedCapture = cap;
    notesValue = cap.notes ?? "";
    tagInput = "";
    timestampInfo = null;
    annotatedScreenshotUrl = null;
    const data = await captureStore.getCaptureBlob(cap.id, "screenshot");
    screenshotUrl = typeof data === "string" ? data : null;

    // Load annotations
    const saved = await captureStore.getAnnotations(cap.id) as Annotation[];
    captureAnnotations = saved;
    if (saved.length > 0 && screenshotUrl) {
      annotatedScreenshotUrl = await exportAnnotatedScreenshot(screenshotUrl, saved);
    }

    if (cap.rfc3161Token) {
      timestampInfo = await verifyTimestamp(cap.rfc3161Token, cap.evidenceHash);
    }
  }

  async function saveAnnotations(annotations: Annotation[]) {
    if (!selectedCapture || !screenshotUrl) return;
    captureAnnotations = annotations;
    await captureStore.saveAnnotations(selectedCapture.id, annotations);
    if (annotations.length > 0) {
      annotatedScreenshotUrl = await exportAnnotatedScreenshot(screenshotUrl, annotations);
    } else {
      annotatedScreenshotUrl = null;
    }
    showAnnotationEditor = false;
  }

  function closeDetail() {
    selectedCapture = null;
    screenshotUrl = null;
    screenshotFullView = false;
    annotatedScreenshotUrl = null;
    captureAnnotations = [];
    exportMenuOpen = false;
  }

  function deleteCapture(id: string) {
    confirmMsg = "Delete this capture? This cannot be undone.";
    confirmAction = async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_CAPTURE", payload: { captureId: id } });
      captures = captures.filter((c) => c.id !== id);
      if (selectedCapture?.id === id) closeDetail();
      applyFilter();
    };
    confirmVisible = true;
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAll() {
    if (selected.size === filtered.length) {
      selected = new Set();
    } else {
      selected = new Set(filtered.map((c) => c.id));
    }
  }

  function exitSelectMode() {
    selectMode = false;
    selected = new Set();
  }

  function reportSelected() {
    reportCaptures = captures.filter((c) => selected.has(c.id));
    showReport = true;
  }

  function reportSingle(cap: CaptureMetadata) {
    reportCaptures = [cap];
    showReport = true;
  }

  function deleteSelected() {
    const count = selected.size;
    if (count === 0) return;
    confirmMsg = `Delete ${count} capture${count > 1 ? "s" : ""}? This cannot be undone.`;
    confirmAction = async () => {
      for (const id of selected) {
        await chrome.runtime.sendMessage({ type: "DELETE_CAPTURE", payload: { captureId: id } });
      }
      captures = captures.filter((c) => !selected.has(c.id));
      applyFilter();
      exitSelectMode();
    };
    confirmVisible = true;
  }

  let exporting = $state(false);

  async function exportCapture(cap: CaptureMetadata, format: "zip" | "warc" = "zip") {
    exporting = true;
    try {
      if (format === "warc") {
        await exportCaptureWarc(cap);
      } else {
        await exportCaptureZip(cap);
      }
    } catch (err) {
      alert("Export failed: " + err);
    }
    exporting = false;
  }

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function formatDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function truncate(text: string, len: number): string {
    return text.length > len ? text.slice(0, len) + "..." : text;
  }

  async function addTags(input: string) {
    if (!selectedCapture) return;
    const newTags = input
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && !selectedCapture!.tags.includes(t));
    if (newTags.length === 0) return;
    const tags = [...selectedCapture.tags, ...newTags];
    selectedCapture.tags = tags;
    await chrome.runtime.sendMessage({
      type: "UPDATE_CAPTURE",
      payload: { captureId: selectedCapture.id, updates: { tags } },
    });
    const idx = captures.findIndex((c) => c.id === selectedCapture!.id);
    if (idx >= 0) captures[idx] = { ...captures[idx], tags };
    applyFilter();
  }

  async function removeTag(tag: string) {
    if (!selectedCapture) return;
    const tags = selectedCapture.tags.filter((t) => t !== tag);
    selectedCapture.tags = tags;
    await chrome.runtime.sendMessage({
      type: "UPDATE_CAPTURE",
      payload: { captureId: selectedCapture.id, updates: { tags } },
    });
    const idx = captures.findIndex((c) => c.id === selectedCapture!.id);
    if (idx >= 0) captures[idx] = { ...captures[idx], tags };
    applyFilter();
  }

  async function saveNotes() {
    if (!selectedCapture) return;
    const notes = notesValue;
    selectedCapture.notes = notes;
    await chrome.runtime.sendMessage({
      type: "UPDATE_CAPTURE",
      payload: { captureId: selectedCapture.id, updates: { notes } },
    });
    const idx = captures.findIndex((c) => c.id === selectedCapture!.id);
    if (idx >= 0) captures[idx] = { ...captures[idx], notes };
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTags(tagInput);
      tagInput = "";
    }
  }

  function toggleFilterTag(tag: string) {
    filterTag = filterTag === tag ? null : tag;
    applyFilter();
  }

  // Watch search changes
  $effect(() => {
    search;
    if (search.trim()) {
      searchContent(search).then((results) => {
        contentResults = new Map(results.map((r) => [r.captureId, r]));
        applyFilter();
      });
    } else {
      contentResults = new Map();
      applyFilter();
    }
  });

  load();
</script>

<div class="evidence-view">
  {#if selectedCapture}
    <!-- Detail View -->
    <div class="detail-view">
      <button class="back-btn" onclick={closeDetail}>&larr; Back</button>

      <span class="detail-header-label">/// evidence file ///</span>

      {#if screenshotUrl}
        <div class="screenshot-area">
          <button class="screenshot-container" onclick={() => (screenshotFullView = true)}>
            <img class="screenshot" src={annotatedScreenshotUrl ?? screenshotUrl} alt="Screenshot" />
            <div class="screenshot-scanlines"></div>
          </button>
          <button class="small-btn annotate-btn" onclick={() => (showAnnotationEditor = true)}>
            {captureAnnotations.length > 0 ? "Edit Annotations" : "Annotate"}
          </button>
        </div>
      {/if}

      {#if screenshotFullView && screenshotUrl}
        <div class="screenshot-overlay" onclick={() => (screenshotFullView = false)} onkeydown={(e) => e.key === "Escape" && (screenshotFullView = false)} role="button" tabindex="-1">
          <img class="screenshot-full" src={annotatedScreenshotUrl ?? screenshotUrl} alt="Full screenshot" />
        </div>
      {/if}

      <h3 class="detail-title">{selectedCapture.title}</h3>
      <a class="detail-url" href={selectedCapture.url} target="_blank">{selectedCapture.url}</a>

      <div class="detail-fields">
        <div class="field">
          <span class="field-label">Captured</span>
          <span class="field-value">{new Date(selectedCapture.timestamp).toLocaleString()}</span>
        </div>
        {#if getRevisitCount(selectedCapture)}
          <div class="field">
            <span class="field-label">Page Visits</span>
            <span class="field-value">{getRevisitCount(selectedCapture)} captures of this URL</span>
          </div>
        {/if}
        <div class="field">
          <span class="field-label">Format</span>
          <span class="field-value">{selectedCapture.format.toUpperCase()}</span>
        </div>
        <div class="field">
          <span class="field-label">Size</span>
          <span class="field-value">{formatSize(selectedCapture.contentSize)}</span>
        </div>
        <div class="field">
          <span class="field-label">Content Hash</span>
          <span class="field-value mono">{selectedCapture.contentHash}</span>
        </div>
        <div class="field">
          <span class="field-label">Evidence Hash</span>
          <span class="field-value mono">{selectedCapture.evidenceHash}</span>
        </div>
        {#if selectedCapture.previousHash}
          <div class="field">
            <span class="field-label">Previous Hash</span>
            <span class="field-value mono">{selectedCapture.previousHash}</span>
          </div>
        {/if}
        {#if selectedCapture.screenshotHash}
          <div class="field">
            <span class="field-label">Screenshot Hash</span>
            <span class="field-value mono">{selectedCapture.screenshotHash}</span>
          </div>
        {/if}
        <div class="field">
          <span class="field-label">Browser</span>
          <span class="field-value">{selectedCapture.browser.name} {selectedCapture.browser.version}</span>
        </div>
        <div class="field">
          <span class="field-label">Trusted Timestamp</span>
          {#if timestampInfo}
            <span class="field-value timestamp-valid">
              {new Date(timestampInfo.genTime).toLocaleString()} (RFC 3161)
            </span>
          {:else if selectedCapture.rfc3161Token}
            <span class="field-value timestamp-invalid">Token present but verification failed</span>
          {:else}
            <span class="field-value timestamp-none">Not available (TSA unreachable at capture time)</span>
          {/if}
        </div>
      </div>

      <!-- Tags -->
      <div class="tags-section">
        <span class="section-label">Tags</span>
        <div class="tags-container">
          {#each selectedCapture.tags as tag}
            <span class="tag-pill">
              {tag}
              <button class="tag-remove" onclick={() => removeTag(tag)}>&times;</button>
            </span>
          {/each}
        </div>
        <input
          class="tag-input"
          type="text"
          placeholder="Add tags (comma-separated, Enter to add)"
          bind:value={tagInput}
          onkeydown={handleTagKeydown}
        />
      </div>

      <!-- Notes -->
      <div class="notes-section">
        <span class="section-label">Notes</span>
        <textarea
          class="notes-textarea"
          placeholder="Add notes about this capture..."
          bind:value={notesValue}
          onblur={saveNotes}
          rows="3"
        ></textarea>
      </div>

      <div class="detail-actions">
        <div class="export-dropdown">
          <button class="action-btn" onclick={() => (exportMenuOpen = !exportMenuOpen)} disabled={exporting}>
            {exporting ? "Exporting..." : "Export ▾"}
          </button>
          {#if exportMenuOpen}
            <div class="export-dropdown-menu">
              <button class="export-dropdown-item" onclick={() => { exportMenuOpen = false; reportSingle(selectedCapture!); }}>Report</button>
              <button class="export-dropdown-item" onclick={() => { exportMenuOpen = false; exportCapture(selectedCapture!); }}>ZIP</button>
              <button class="export-dropdown-item" onclick={() => { exportMenuOpen = false; exportCapture(selectedCapture!, "warc"); }}>WARC</button>
            </div>
          {/if}
        </div>
        <button class="action-btn danger" onclick={() => deleteCapture(selectedCapture!.id)}>Delete</button>
      </div>
    </div>
  {:else}
    <!-- List View -->
    <div class="view-header">
      <h2>Evidence</h2>
      <div class="header-actions">
        <div class="view-toggle">
          <button class="view-toggle-btn" class:active={viewMode === "list"} onclick={() => (viewMode = "list")} title="List view">☰</button>
          <button class="view-toggle-btn" class:active={viewMode === "timeline"} onclick={() => (viewMode = "timeline")} title="Timeline view">⏐</button>
        </div>
        {#if selectMode}
          <button class="small-btn" onclick={exitSelectMode}>Cancel</button>
        {:else if viewMode === "list"}
          <button class="small-btn" onclick={() => (selectMode = true)}>Select</button>
        {/if}
        <span class="count">{filtered.length}</span>
      </div>
    </div>

    {#if selectMode}
      <div class="select-bar">
        <button class="small-btn" onclick={selectAll}>
          {selected.size === filtered.length ? "Deselect All" : "Select All"}
        </button>
        <span class="select-count">{selected.size} selected</span>
        <button class="small-btn" onclick={reportSelected} disabled={selected.size === 0}>
          Report
        </button>
        <button class="small-btn danger" onclick={deleteSelected} disabled={selected.size === 0}>
          Delete
        </button>
      </div>
    {/if}

    <input
      class="search-input"
      type="text"
      placeholder="Search titles, URLs, tags, or page content..."
      bind:value={search}
    />

    {#if getAllTags().length > 0}
      <div class="tag-filter-bar">
        {#each getAllTags() as tag}
          <button
            class="tag-filter-pill"
            class:active={filterTag === tag}
            onclick={() => toggleFilterTag(tag)}
          >{tag}</button>
        {/each}
        {#if filterTag}
          <button class="tag-filter-clear" onclick={() => { filterTag = null; applyFilter(); }}>Clear</button>
        {/if}
      </div>
    {/if}

    {#if viewMode === "timeline"}
      <Timeline captures={filtered} onSelect={(id) => viewCaptureById(id)} />
    {:else}
      <div class="capture-list">
        {#if filtered.length === 0}
          <p class="empty">{search ? "No matches." : "No captures yet."}</p>
        {:else}
          {#each filtered as cap (cap.id)}
            <button class="capture-row" class:selected={selectMode && selected.has(cap.id)} onclick={() => selectMode ? toggleSelect(cap.id) : viewCapture(cap)}>
              {#if selectMode}
                <span class="row-checkbox" class:checked={selected.has(cap.id)}></span>
              {/if}
              <div class="row-content">
                <div class="row-top">
                  <span class="row-domain">{formatDomain(cap.url)}</span>
                  <span class="row-time">{formatTime(cap.timestamp)}</span>
                </div>
                <div class="row-title">{truncate(cap.title, 55)}</div>
                {#if getContentSnippet(cap.id)}
                  <div class="content-snippet">{getContentSnippet(cap.id)}</div>
                {/if}
                <div class="row-meta">
                  <span class="mono">#{cap.contentHash.slice(0, 8)}</span>
                  <span>{formatSize(cap.contentSize)}</span>
                  {#if cap.selectorHits.length > 0}
                    <span class="hits">{cap.selectorHits.length} hits</span>
                  {/if}
                  {#if getRevisitCount(cap)}
                    <span class="revisit-badge">{getRevisitCount(cap)}x visited</span>
                  {/if}
                </div>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<ConfirmDialog
  bind:visible={confirmVisible}
  title="Delete Evidence"
  message={confirmMsg}
  confirmText="Delete"
  danger={true}
  onConfirm={() => confirmAction?.()}
/>

{#if showReport}
  <ReportBuilder
    captures={reportCaptures}
    onClose={() => (showReport = false)}
  />
{/if}

{#if showAnnotationEditor && screenshotUrl}
  <AnnotationEditor
    {screenshotUrl}
    existingAnnotations={captureAnnotations}
    onSave={saveAnnotations}
    onClose={() => (showAnnotationEditor = false)}
  />
{/if}

<script lang="ts">
  import type { CaptureMetadata } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";

  let { onNavigate }: { onNavigate: (tab: string, captureId?: string) => void } = $props();

  interface FindingSource {
    captureId: string;
    domain: string;
    title: string;
  }

  interface Finding {
    type: string;
    value: string;
    captureIds: string[];
    pages: FindingSource[];
    firstSeen: string;
    lastSeen: string;
  }

  let findings: Finding[] = $state([]);
  let filterType = $state<string | null>(null);
  let search = $state("");

  const typeLabels: Record<string, string> = {
    "Auto: email": "Emails",
    "Auto: phone": "Phones",
    "Auto: crypto": "Crypto",
    "Auto: ip": "IPs",
    "Auto: social-handle": "Handles",
  };

  const typeColors: Record<string, string> = {
    "Auto: email": "#3b82f6",
    "Auto: phone": "#10b981",
    "Auto: crypto": "#f59e0b",
    "Auto: ip": "#8b5cf6",
    "Auto: social-handle": "#ec4899",
  };

  export async function load() {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    const caseId = status.activeCaseId;
    let captures: CaptureMetadata[];
    if (caseId) {
      captures = await captureStore.getCapturesByCase(caseId);
    } else {
      captures = await captureStore.getRecentCaptures(9999);
    }

    const map = new Map<string, Finding>();
    for (const cap of captures) {
      for (const hit of cap.selectorHits) {
        if (!hit.selectorId.startsWith("auto")) continue;
        const key = `${hit.selectorName}:${hit.matchedText}`;
        const existing = map.get(key);
        const domain = getDomain(cap.url);
        const page: FindingSource = { captureId: cap.id, domain, title: cap.title };
        if (existing) {
          if (!existing.captureIds.includes(cap.id)) {
            existing.captureIds.push(cap.id);
            existing.pages.push(page);
          }
          if (cap.timestamp < existing.firstSeen) existing.firstSeen = cap.timestamp;
          if (cap.timestamp > existing.lastSeen) existing.lastSeen = cap.timestamp;
        } else {
          map.set(key, {
            type: hit.selectorName,
            value: hit.matchedText,
            captureIds: [cap.id],
            pages: [page],
            firstSeen: cap.timestamp,
            lastSeen: cap.timestamp,
          });
        }
      }
    }

    findings = [...map.values()].sort((a, b) => b.captureIds.length - a.captureIds.length);
  }

  function getFiltered(): Finding[] {
    let result = findings;
    if (filterType) {
      result = result.filter((f) => f.type === filterType);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((f) => f.value.toLowerCase().includes(q));
    }
    return result;
  }

  function getTypes(): string[] {
    const types = new Set(findings.map((f) => f.type));
    return [...types].sort();
  }

  function getTypeCount(type: string): number {
    return findings.filter((f) => f.type === type).length;
  }

  function truncate(text: string, len: number): string {
    return text.length > len ? text.slice(0, len) + "..." : text;
  }

  function getDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return ""; }
  }

  function formatDate(ts: string): string {
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  load();
</script>

<div class="findings-view">
  <div class="view-header">
    <h2>Findings</h2>
    <span class="count">{findings.length}</span>
  </div>

  <p class="view-desc">Auto-detected entities found across captured pages. Click to see where each was found.</p>

  {#if findings.length === 0}
    <p class="empty">No findings yet. Enable smart detection in Settings and capture some pages.</p>
  {:else}
    <div class="findings-types">
      <button class="finding-type-btn" class:active={!filterType} onclick={() => (filterType = null)}>
        All ({findings.length})
      </button>
      {#each getTypes() as type}
        <button
          class="finding-type-btn"
          class:active={filterType === type}
          style="--type-color: {typeColors[type] ?? 'var(--accent)'}"
          onclick={() => (filterType = filterType === type ? null : type)}
        >
          {typeLabels[type] ?? type} ({getTypeCount(type)})
        </button>
      {/each}
    </div>

    <input
      class="search-input"
      type="text"
      placeholder="Search findings..."
      bind:value={search}
    />

    <div class="findings-list">
      {#each getFiltered() as finding}
        <div class="finding-card">
          <div class="finding-top">
            <span class="finding-type-badge" style="color: {typeColors[finding.type] ?? 'var(--accent)'}">
              {typeLabels[finding.type] ?? finding.type}
            </span>
            <span class="finding-pages">{finding.captureIds.length} page{finding.captureIds.length > 1 ? "s" : ""}</span>
          </div>
          <div class="finding-value">{finding.value}</div>
          <div class="finding-pages-list">
            {#each finding.pages.slice(0, 3) as page}
              <button class="finding-page" onclick={() => onNavigate("evidence", page.captureId)}>
                <span class="finding-page-domain">{page.domain}</span>
                <span class="finding-page-title">{truncate(page.title, 40)}</span>
              </button>
            {/each}
            {#if finding.pages.length > 3}
              <span class="finding-source-more">+{finding.pages.length - 3} more pages</span>
            {/if}
          </div>
          <div class="finding-meta">
            <span>First: {formatDate(finding.firstSeen)}</span>
            {#if finding.firstSeen !== finding.lastSeen}
              <span>Last: {formatDate(finding.lastSeen)}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<script lang="ts">
  import type { CaptureMetadata, Case } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";

  let {
    captureEnabled = $bindable(false),
    onNavigate,
  }: {
    captureEnabled: boolean;
    onNavigate: (tab: string, captureId?: string) => void;
  } = $props();

  let captures: CaptureMetadata[] = $state([]);
  let allCaptures: CaptureMetadata[] = $state([]);
  let stats = $state({ totalCaptures: 0, totalCases: 0, totalSelectors: 0 });
  let activeCaseId = $state<string | null>(null);
  let activeCaseName = $state("Default Case");

  export async function load() {
    const allCases = await captureStore.getAllCases();
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    captureEnabled = status.captureEnabled;
    activeCaseId = status.activeCaseId ?? null;
    if (activeCaseId) {
      const c = await captureStore.getCase(activeCaseId);
      if (c) activeCaseName = c.name;
      // Show case-specific captures
      const caseCaptures = await captureStore.getCapturesByCase(activeCaseId);
      caseCaptures.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      allCaptures = caseCaptures;
      captures = caseCaptures.slice(0, 10);
      const selectors = await captureStore.getSelectors(activeCaseId);
      stats = {
        totalCaptures: caseCaptures.length,
        totalCases: allCases.length,
        totalSelectors: selectors.length,
      };
    } else {
      const recent = await captureStore.getRecentCaptures(10);
      allCaptures = recent;
      captures = recent;
      stats = await captureStore.getStats();
    }
  }

  async function toggleCapture() {
    const result = await chrome.runtime.sendMessage({ type: "TOGGLE_CAPTURE" });
    captureEnabled = result.captureEnabled;
  }

  async function captureNow() {
    await chrome.runtime.sendMessage({ type: "CAPTURE_CURRENT" });
    // Small delay for DB write to complete
    setTimeout(() => load(), 500);
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

  function normalizeUrl(url: string): string {
    try { const u = new URL(url); u.hash = ""; return u.origin + u.pathname; } catch { return url; }
  }

  let urlStats = $derived.by(() => {
    const stats = new Map<string, number>();
    for (const cap of allCaptures) {
      const key = normalizeUrl(cap.url);
      stats.set(key, (stats.get(key) ?? 0) + 1);
    }
    return stats;
  });

  function getRevisitCount(url: string): number | null {
    const count = urlStats.get(normalizeUrl(url));
    return count && count > 1 ? count : null;
  }

  let dailySummary = $derived.by(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

    const dayMap = new Map<string, { count: number; domains: Set<string>; selectorHits: number }>();

    for (const cap of allCaptures) {
      const date = cap.timestamp.slice(0, 10);
      if (date < cutoff) continue;
      let entry = dayMap.get(date);
      if (!entry) {
        entry = { count: 0, domains: new Set(), selectorHits: 0 };
        dayMap.set(date, entry);
      }
      entry.count++;
      try { entry.domains.add(new URL(cap.url).hostname); } catch { /* skip */ }
      entry.selectorHits += cap.selectorHits.length;
    }

    const result = Array.from(dayMap.entries())
      .map(([date, e]) => ({ date, count: e.count, domains: e.domains.size, selectorHits: e.selectorHits }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return result;
  });

  let maxDayCount = $derived(Math.max(...dailySummary.map((d) => d.count), 1));

  function formatDayDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    if (dateStr === todayStr) return "Today";
    if (dateStr === yesterdayStr) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  // Initial load
  load();
</script>

<div class="dashboard">
  <!-- Stats -->
  <div class="stats-grid">
    <button class="stat-card" onclick={() => onNavigate("evidence")}>
      <span class="stat-num">{stats.totalCaptures}</span>
      <span class="stat-label">Captures</span>
    </button>
    <button class="stat-card" onclick={() => onNavigate("cases")}>
      <span class="stat-num">{stats.totalCases}</span>
      <span class="stat-label">Cases</span>
    </button>
    <button class="stat-card" onclick={() => onNavigate("selectors")}>
      <span class="stat-num">{stats.totalSelectors}</span>
      <span class="stat-label">Selectors</span>
    </button>
  </div>

  <!-- Quick Capture -->
  <button class="capture-btn" onclick={captureNow}>
    Capture this page
  </button>

  <!-- Activity -->
  {#if dailySummary.length > 0}
    <div class="section">
      <h3 class="section-title">Activity</h3>
      <div class="daily-summary">
        {#each dailySummary as day}
          <div class="day-row">
            <span class="day-date">{formatDayDate(day.date)}</span>
            <div class="day-stats">
              <span class="day-captures">{day.count} captures</span>
              <span class="day-domains">{day.domains} sites</span>
              {#if day.selectorHits > 0}
                <span class="day-hits">{day.selectorHits} hits</span>
              {/if}
            </div>
            <div class="day-bar" style="width: {(day.count / maxDayCount) * 100}%"></div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Recent -->
  <div class="section">
    <div class="section-header">
      <h3 class="section-title">Recent</h3>
      {#if captures.length > 0}
        <button class="see-all" onclick={() => onNavigate("evidence")}>See all</button>
      {/if}
    </div>
    {#if captures.length === 0}
      <p class="empty">No captures yet. Enable recording and browse.</p>
    {:else}
      {#each captures as cap (cap.id)}
        <button class="capture-row" onclick={() => onNavigate("evidence", cap.id)}>
          <div class="row-content">
            <div class="row-top">
              <span class="row-domain">{formatDomain(cap.url)}</span>
              <span class="row-time">{formatTime(cap.timestamp)}</span>
            </div>
            <div class="row-title">{truncate(cap.title, 55)}</div>
            <div class="row-meta">
              <span class="mono">#{cap.contentHash.slice(0, 8)}</span>
              <span>{formatSize(cap.contentSize)}</span>
              {#if cap.selectorHits.length > 0}
                <span class="hits">{cap.selectorHits.length} hits</span>
              {/if}
              {#if getRevisitCount(cap.url)}
                <span class="revisit-badge">{getRevisitCount(cap.url)}x visited</span>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

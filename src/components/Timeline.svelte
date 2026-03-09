<script lang="ts">
  import type { CaptureMetadata } from "../shared/index.js";

  let {
    captures,
    onSelect,
  }: {
    captures: CaptureMetadata[];
    onSelect: (captureId: string) => void;
  } = $props();

  interface DayGroup {
    date: string;
    label: string;
    captures: CaptureMetadata[];
  }

  function groupByDay(): DayGroup[] {
    const map = new Map<string, CaptureMetadata[]>();
    for (const cap of captures) {
      const date = cap.timestamp.slice(0, 10);
      const existing = map.get(date);
      if (existing) existing.push(cap);
      else map.set(date, [cap]);
    }

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, caps]) => ({
        date,
        label: date === today ? "Today" : date === yesterday ? "Yesterday" : formatDayLabel(date),
        captures: caps.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      }));
  }

  function formatDayLabel(dateStr: string): string {
    return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  function truncate(text: string, len: number): string {
    return text.length > len ? text.slice(0, len) + "..." : text;
  }
</script>

<div class="timeline">
  {#each groupByDay() as day}
    <div class="timeline-day">
      <div class="timeline-day-header">
        <span class="timeline-day-label">{day.label}</span>
        <span class="timeline-day-count">{day.captures.length}</span>
      </div>
      <div class="timeline-entries">
        {#each day.captures as cap (cap.id)}
          <button class="timeline-entry" onclick={() => onSelect(cap.id)}>
            <div class="timeline-dot" class:has-hits={cap.selectorHits.length > 0}></div>
            <div class="timeline-line"></div>
            <div class="timeline-card">
              <div class="timeline-time">{formatTime(cap.timestamp)}</div>
              <div class="timeline-domain">{formatDomain(cap.url)}</div>
              <div class="timeline-title">{truncate(cap.title, 50)}</div>
              {#if cap.tags.length > 0 || cap.selectorHits.length > 0}
                <div class="timeline-badges">
                  {#each cap.tags.slice(0, 3) as tag}
                    <span class="timeline-tag">{tag}</span>
                  {/each}
                  {#if cap.selectorHits.length > 0}
                    <span class="timeline-hits">{cap.selectorHits.length} hits</span>
                  {/if}
                </div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/each}
  {#if captures.length === 0}
    <p class="empty">No captures to show.</p>
  {/if}
</div>

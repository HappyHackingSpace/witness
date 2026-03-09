<script lang="ts">
  import type { Case } from "../shared/index.js";

  let {
    cases,
    activeCaseId,
    onSwitch,
  }: {
    cases: Case[];
    activeCaseId: string | null;
    onSwitch: (caseId: string) => void;
  } = $props();

  let open = $state(false);

  function activeName(): string {
    const c = cases.find((cs) => cs.id === activeCaseId);
    return c?.name ?? "Default Case";
  }

  function select(caseId: string) {
    open = false;
    if (caseId !== activeCaseId) onSwitch(caseId);
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".case-dropdown")) open = false;
  }
</script>

<svelte:document onclick={handleClickOutside} />

<div class="case-dropdown">
  <button class="case-dropdown-trigger" onclick={() => (open = !open)}>
    <span class="case-dropdown-value">{activeName()}</span>
    <span class="case-dropdown-arrow">{open ? "▴" : "▾"}</span>
  </button>
  {#if open}
    <div class="case-dropdown-menu">
      {#each cases as c (c.id)}
        <button
          class="case-dropdown-item"
          class:active={c.id === activeCaseId}
          onclick={() => select(c.id)}
        >
          {#if c.id === activeCaseId}<span class="check">✓</span>{/if}
          {c.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

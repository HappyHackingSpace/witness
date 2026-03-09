<script lang="ts">
  let {
    value = $bindable(""),
    options,
  }: {
    value: string;
    options: { value: string; label: string }[];
  } = $props();

  let open = $state(false);

  function activeLabel(): string {
    return options.find((o) => o.value === value)?.label ?? value;
  }

  function select(val: string) {
    value = val;
    open = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".custom-select")) open = false;
  }
</script>

<svelte:document onclick={handleClickOutside} />

<div class="custom-select">
  <button class="custom-select-trigger" onclick={() => (open = !open)}>
    <span class="custom-select-value">{activeLabel()}</span>
    <span class="custom-select-arrow">{open ? "▴" : "▾"}</span>
  </button>
  {#if open}
    <div class="custom-select-menu">
      {#each options as opt (opt.value)}
        <button
          class="custom-select-item"
          class:active={opt.value === value}
          onclick={() => select(opt.value)}
        >
          {#if opt.value === value}<span class="check">✓</span>{/if}
          {opt.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<script lang="ts">
  import type { Selector, SelectorType } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CustomSelect from "./CustomSelect.svelte";

  let selectors: Selector[] = $state([]);
  let showCreate = $state(false);
  let newName = $state("");
  let newPattern = $state("");
  let newType: SelectorType = $state("keyword");
  let newIsRegex = $state(false);
  let confirmVisible = $state(false);
  let confirmAction = $state<(() => void) | null>(null);
  let confirmMsg = $state("");

  const selectorTypes: { value: SelectorType; label: string }[] = [
    { value: "keyword", label: "Keyword" },
    { value: "username", label: "Username" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "crypto", label: "Crypto Address" },
    { value: "custom", label: "Custom" },
  ];

  export async function load() {
    selectors = await captureStore.getSelectors();
  }

  async function createSelector() {
    if (!newName.trim() || !newPattern.trim()) return;
    // Validate regex if needed
    if (newIsRegex) {
      try { new RegExp(newPattern); } catch {
        alert("Invalid regular expression.");
        return;
      }
    }
    const id = crypto.randomUUID();
    await captureStore.saveSelector({
      id,
      name: newName.trim(),
      pattern: newPattern.trim(),
      type: newType,
      isRegex: newIsRegex,
      enabled: true,
      caseId: null, // Global selector
      createdAt: new Date().toISOString(),
      hitCount: 0,
    });
    newName = "";
    newPattern = "";
    newType = "keyword";
    newIsRegex = false;
    showCreate = false;
    await load();
  }

  async function toggleSelector(sel: Selector) {
    await captureStore.saveSelector({ ...sel, enabled: !sel.enabled });
    await load();
  }

  function deleteSelector(id: string) {
    const sel = selectors.find((s) => s.id === id);
    confirmMsg = `Delete selector "${sel?.name ?? "this selector"}"?`;
    confirmAction = async () => {
      await captureStore.deleteSelector(id);
      await load();
    };
    confirmVisible = true;
  }

  function typeColor(type: SelectorType): string {
    const colors: Record<SelectorType, string> = {
      keyword: "#6366f1",
      username: "#8b5cf6",
      email: "#3b82f6",
      phone: "#10b981",
      crypto: "#f59e0b",
      custom: "#ef4444",
    };
    return colors[type];
  }

  load();
</script>

<div class="selectors-view">
  <div class="view-header">
    <h2>Selectors</h2>
    <button class="add-btn" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? "Cancel" : "+ New"}
    </button>
  </div>

  <p class="view-desc">Selectors track identifiers (usernames, emails, keywords) across all captured pages. Matches are highlighted in evidence.</p>

  {#if showCreate}
    <div class="create-form">
      <input
        type="text"
        placeholder="Name (e.g. 'Target Email')"
        bind:value={newName}
      />
      <input
        type="text"
        placeholder="Pattern (e.g. 'user@example.com')"
        bind:value={newPattern}
      />
      <div class="form-row">
        <CustomSelect bind:value={newType} options={selectorTypes} />
        <button class="toggle-pill" class:active={newIsRegex} onclick={() => (newIsRegex = !newIsRegex)}>
          Regex
        </button>
      </div>
      <button class="primary-btn" onclick={createSelector} disabled={!newName.trim() || !newPattern.trim()}>
        Create Selector
      </button>
    </div>
  {/if}

  <div class="selector-list">
    {#if selectors.length === 0 && !showCreate}
      <p class="empty">No selectors yet. Create one to start tracking identifiers.</p>
    {:else}
      {#each selectors as sel (sel.id)}
        <div class="selector-card" class:disabled={!sel.enabled}>
          <div class="sel-top">
            <span class="sel-type" style="color: {typeColor(sel.type)}">{sel.type}</span>
            <span class="sel-name">{sel.name}</span>
          </div>
          <div class="sel-pattern">
            {#if sel.isRegex}<span class="regex-badge">regex</span>{/if}
            <code>{sel.pattern}</code>
          </div>
          <div class="sel-actions">
            <button class="small-btn" onclick={() => toggleSelector(sel)}>
              {sel.enabled ? "Disable" : "Enable"}
            </button>
            <button class="small-btn danger" onclick={() => deleteSelector(sel.id)}>Delete</button>
            <span class="hit-count">{sel.hitCount} hits</span>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:visible={confirmVisible}
  title="Delete Selector"
  message={confirmMsg}
  confirmText="Delete"
  danger={true}
  onConfirm={() => confirmAction?.()}
/>

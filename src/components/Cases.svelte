<script lang="ts">
  import type { Case } from "../shared/index.js";
  import { captureStore } from "../lib/store.js";
  import { exportCase, exportCaseWarc } from "../lib/export.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ReportBuilder from "./ReportBuilder.svelte";

  let { onNavigate }: { onNavigate: (tab: string, captureId?: string) => void } = $props();

  let cases: Case[] = $state([]);
  let activeCaseId = $state<string | null>(null);
  let showCreate = $state(false);
  let editingId = $state<string | null>(null);
  let newName = $state("");
  let confirmVisible = $state(false);
  let confirmAction = $state<(() => void) | null>(null);
  let confirmMsg = $state("");
  let newDescription = $state("");
  let editName = $state("");
  let showReport = $state(false);
  let reportCase = $state<Case | undefined>();
  let reportCaptures = $state<import("../shared/index.js").CaptureMetadata[]>([]);
  let exportMenuId = $state<string | null>(null);

  function toggleExportMenu(caseId: string) {
    exportMenuId = exportMenuId === caseId ? null : caseId;
  }

  function handleExport(action: () => void) {
    exportMenuId = null;
    action();
  }

  export async function load() {
    cases = await captureStore.getAllCases();
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    activeCaseId = status.activeCaseId;
    // Get capture counts
    for (const c of cases) {
      const captures = await captureStore.getCapturesByCase(c.id);
      c.captureCount = captures.length;
    }
    cases = [...cases]; // trigger reactivity
  }

  async function createCase() {
    if (!newName.trim()) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await captureStore.createCase({
      id,
      name: newName.trim(),
      description: newDescription.trim(),
      investigator: "",
      caseNumber: "",
      createdAt: now,
      updatedAt: now,
      tags: [],
      captureCount: 0,
      storageUsed: 0,
    });
    newName = "";
    newDescription = "";
    showCreate = false;
    await load();
  }

  async function switchCase(caseId: string) {
    await chrome.runtime.sendMessage({ type: "SET_ACTIVE_CASE", payload: { caseId } });
    activeCaseId = caseId;
  }

  async function openCaseEvidence(caseId: string) {
    await switchCase(caseId);
    onNavigate("evidence");
  }

  function deleteCase(caseId: string) {
    if (cases.length <= 1) {
      confirmMsg = "Cannot delete the last case.";
      confirmAction = null;
      confirmVisible = true;
      return;
    }
    const c = cases.find((cs) => cs.id === caseId);
    confirmMsg = `Delete "${c?.name ?? "this case"}" and all its captures?`;
    confirmAction = async () => {
      const captures = await captureStore.getCapturesByCase(caseId);
      for (const cap of captures) {
        await captureStore.deleteCapture(cap.id);
      }
      await captureStore.deleteCase(caseId);
      if (activeCaseId === caseId) {
        const remaining = cases.filter((cs) => cs.id !== caseId);
        if (remaining.length > 0) {
          await switchCase(remaining[0].id);
        }
      }
      await load();
    };
    confirmVisible = true;
  }

  async function startEdit(c: Case) {
    editingId = c.id;
    editName = c.name;
  }

  async function saveEdit(c: Case) {
    if (!editName.trim()) return;
    await captureStore.createCase({ ...c, name: editName.trim(), updatedAt: new Date().toISOString() });
    editingId = null;
    await load();
  }

  async function generateCaseReport(c: Case) {
    const captures = await captureStore.getCapturesByCase(c.id);
    captures.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    reportCaptures = captures;
    reportCase = c;
    showReport = true;
  }

  function formatDate(ts: string): string {
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  load();
</script>

<svelte:document onclick={(e) => {
  if (!(e.target as HTMLElement)?.closest(".export-dropdown")) exportMenuId = null;
}} />

<div class="cases-view">
  <div class="view-header">
    <h2>Cases</h2>
    <button class="add-btn" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? "Cancel" : "+ New"}
    </button>
  </div>

  <p class="view-desc">Cases are investigation folders. Each capture belongs to the active case.</p>

  {#if showCreate}
    <div class="create-form">
      <input
        type="text"
        placeholder="Case name (e.g. 'Phishing Investigation')"
        bind:value={newName}
        onkeydown={(e) => e.key === "Enter" && createCase()}
      />
      <textarea
        placeholder="Description (optional)"
        bind:value={newDescription}
        rows="2"
      ></textarea>
      <button class="primary-btn" onclick={createCase} disabled={!newName.trim()}>
        Create Case
      </button>
    </div>
  {/if}

  <div class="case-list">
    {#each cases as c (c.id)}
      <div class="case-card" class:active={c.id === activeCaseId}>
        <div class="case-top">
          {#if editingId === c.id}
            <input
              class="edit-input"
              type="text"
              bind:value={editName}
              onkeydown={(e) => { if (e.key === "Enter") saveEdit(c); if (e.key === "Escape") editingId = null; }}
            />
          {:else}
            <button class="case-name-link" onclick={() => openCaseEvidence(c.id)}>{c.name}</button>
          {/if}
          {#if c.id === activeCaseId}
            <span class="active-badge">Active</span>
          {/if}
        </div>
        {#if c.description}
          <p class="case-desc">{c.description}</p>
        {/if}
        <div class="case-meta">
          <span>{c.captureCount} captures</span>
          <span>Created {formatDate(c.createdAt)}</span>
        </div>
        <div class="case-actions">
          {#if c.id !== activeCaseId}
            <button class="small-btn" onclick={() => switchCase(c.id)}>Set Active</button>
          {/if}
          {#if editingId === c.id}
            <button class="small-btn" onclick={() => saveEdit(c)}>Save</button>
            <button class="small-btn" onclick={() => (editingId = null)}>Cancel</button>
          {:else}
            <button class="small-btn" onclick={() => startEdit(c)}>Rename</button>
          {/if}
          <div class="export-dropdown">
            <button class="small-btn" onclick={() => toggleExportMenu(c.id)}>Export ▾</button>
            {#if exportMenuId === c.id}
              <div class="export-dropdown-menu">
                <button class="export-dropdown-item" onclick={() => handleExport(() => generateCaseReport(c))}>Report</button>
                <button class="export-dropdown-item" onclick={() => handleExport(() => exportCase(c))}>ZIP</button>
                <button class="export-dropdown-item" onclick={() => handleExport(() => exportCaseWarc(c))}>WARC</button>
              </div>
            {/if}
          </div>
          <button class="small-btn danger" onclick={() => deleteCase(c.id)}>Delete</button>
        </div>
      </div>
    {/each}
  </div>
</div>

<ConfirmDialog
  bind:visible={confirmVisible}
  title="Delete Case"
  message={confirmMsg}
  confirmText={confirmAction ? "Delete" : "OK"}
  danger={!!confirmAction}
  onConfirm={() => confirmAction?.()}
/>

{#if showReport}
  <ReportBuilder
    captures={reportCaptures}
    caseInfo={reportCase}
    onClose={() => (showReport = false)}
  />
{/if}

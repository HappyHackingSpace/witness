<script lang="ts">
  import { onMount } from "svelte";
  import type { Case } from "../../shared/index.js";
  import Dashboard from "../../components/Dashboard.svelte";
  import Cases from "../../components/Cases.svelte";
  import Evidence from "../../components/Evidence.svelte";
  import Selectors from "../../components/Selectors.svelte";
  import Findings from "../../components/Findings.svelte";
  import Settings from "../../components/Settings.svelte";
  import CaseDropdown from "../../components/CaseDropdown.svelte";
  import { captureStore } from "../../lib/store.js";

  type Tab = "dashboard" | "evidence" | "cases" | "selectors" | "settings";

  let activeTab: Tab = $state("dashboard");
  let captureEnabled = $state(false);
  let activeCaseId = $state<string | null>(null);
  let activeCaseName = $state("");
  let allCases: Case[] = $state([]);

  let dashboardRef: Dashboard | undefined = $state();
  let casesRef: Cases | undefined = $state();
  let evidenceRef: Evidence | undefined = $state();
  let selectorsRef: Selectors | undefined = $state();
  let findingsRef: Findings | undefined = $state();
  let settingsRef: Settings | undefined = $state();
  let intelSubTab = $state<"findings" | "selectors">("findings");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard", label: "Home", icon: "△" },
    { id: "evidence", label: "Evidence", icon: "◈" },
    { id: "cases", label: "Cases", icon: "⬡" },
    { id: "selectors", label: "Intel", icon: "◎" },
    { id: "settings", label: "Settings", icon: "⟐" },
  ];

  let pendingCaptureId: string | null = $state(null);

  async function loadCaseInfo() {
    try {
      allCases = await captureStore.getAllCases();
      const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      captureEnabled = status.captureEnabled ?? false;
      activeCaseId = status.activeCaseId ?? null;
      if (activeCaseId) {
        const c = await captureStore.getCase(activeCaseId);
        activeCaseName = c?.name ?? "";
      }
    } catch {}
  }

  async function toggleCapture() {
    const result = await chrome.runtime.sendMessage({ type: "TOGGLE_CAPTURE" });
    captureEnabled = result.captureEnabled;
  }

  async function switchCase(caseId: string) {
    await chrome.runtime.sendMessage({ type: "SET_ACTIVE_CASE", payload: { caseId } });
    activeCaseId = caseId;
    const c = allCases.find((cs) => cs.id === caseId);
    if (c) activeCaseName = c.name;
    refreshCurrentTab();
  }

  function navigate(tab: string, captureId?: string) {
    pendingCaptureId = captureId ?? null;
    activeTab = tab as Tab;
  }

  onMount(() => {
    loadCaseInfo();
    // Listen for capture events to refresh active view
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "CAPTURE_COMPLETE") {
        if (activeTab === "dashboard") dashboardRef?.load();
        if (activeTab === "evidence") evidenceRef?.load();
      }
      if (message.type === "CAPTURE_STATE_CHANGED") {
        captureEnabled = message.payload.captureEnabled;
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        loadCaseInfo();
        refreshCurrentTab();
      }
    });
  });

  function refreshCurrentTab() {
    loadCaseInfo();
    switch (activeTab) {
      case "dashboard": dashboardRef?.load(); break;
      case "evidence": evidenceRef?.load(); break;
      case "cases": casesRef?.load(); break;
      case "selectors":
        if (intelSubTab === "findings") findingsRef?.load();
        else selectorsRef?.load();
        break;
      case "settings": settingsRef?.load(); break;
    }
  }

  // Refresh when switching tabs
  $effect(() => {
    activeTab;
    // Use setTimeout to wait for component to mount
    setTimeout(() => {
      if (pendingCaptureId && activeTab === "evidence") {
        evidenceRef?.viewCaptureById(pendingCaptureId);
        pendingCaptureId = null;
      } else {
        refreshCurrentTab();
      }
    }, 0);
  });
</script>

<div class="witness-panel">
  <!-- Header -->
  <header class="header">
    <div class="header-scan-line"></div>
    <div class="header-left">
      <h1 class="logo">Witness</h1>
      <button class="header-rec-toggle" class:active={captureEnabled} onclick={toggleCapture}>
        <span class="header-rec-dot"></span>
        {captureEnabled ? "REC" : "PAUSED"}
      </button>
    </div>
    <div class="header-right">
      {#if allCases.length > 1}
        <CaseDropdown cases={allCases} {activeCaseId} onSwitch={switchCase} />
      {:else if activeCaseName}
        <button class="header-case" onclick={() => navigate("cases")}>{activeCaseName}</button>
      {/if}
    </div>
  </header>

  <!-- Content -->
  <main class="content">
    {#if activeTab === "dashboard"}
      <Dashboard bind:this={dashboardRef} bind:captureEnabled onNavigate={navigate} />
    {:else if activeTab === "evidence"}
      <Evidence bind:this={evidenceRef} />
    {:else if activeTab === "cases"}
      <Cases bind:this={casesRef} onNavigate={navigate} />
    {:else if activeTab === "selectors"}
      <div class="intel-tabs">
        <button class="intel-tab" class:active={intelSubTab === "findings"} onclick={() => (intelSubTab = "findings")}>Findings</button>
        <button class="intel-tab" class:active={intelSubTab === "selectors"} onclick={() => (intelSubTab = "selectors")}>Selectors</button>
      </div>
      {#if intelSubTab === "findings"}
        <Findings bind:this={findingsRef} onNavigate={navigate} />
      {:else}
        <Selectors bind:this={selectorsRef} />
      {/if}
    {:else if activeTab === "settings"}
      <Settings bind:this={settingsRef} />
    {/if}
  </main>

  <!-- Bottom Navigation -->
  <nav class="bottom-nav">
    {#each tabs as tab}
      <button
        class="nav-btn"
        class:active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        <span class="nav-icon">{tab.icon}</span>
        <span class="nav-label">{tab.label}</span>
      </button>
    {/each}
  </nav>
</div>

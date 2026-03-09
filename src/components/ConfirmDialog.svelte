<script lang="ts">
  let {
    visible = $bindable(false),
    title = "Confirm",
    message = "Are you sure?",
    confirmText = "Delete",
    cancelText = "Cancel",
    danger = false,
    onConfirm,
    onCancel,
  }: {
    visible: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  } = $props();

  function handleConfirm() {
    visible = false;
    onConfirm();
  }

  function handleCancel() {
    visible = false;
    onCancel?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") handleCancel();
  }
</script>

{#if visible}
  <div class="confirm-overlay" onclick={handleCancel} onkeydown={handleKeydown} role="button" tabindex="-1">
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="confirm-title">{title}</div>
      <div class="confirm-message">{message}</div>
      <div class="confirm-actions">
        <button class="confirm-btn cancel" onclick={handleCancel}>{cancelText}</button>
        <button class="confirm-btn" class:danger onclick={handleConfirm}>{confirmText}</button>
      </div>
    </div>
  </div>
{/if}

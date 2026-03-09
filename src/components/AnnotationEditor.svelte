<script lang="ts">
  import { onMount } from "svelte";
  import { renderAnnotations, type Annotation, type AnnotationType } from "../lib/annotations.js";

  let {
    screenshotUrl,
    existingAnnotations = [],
    onSave,
    onClose,
  }: {
    screenshotUrl: string;
    existingAnnotations?: Annotation[];
    onSave: (annotations: Annotation[]) => void;
    onClose: () => void;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let img: HTMLImageElement | undefined = $state();
  let annotations: Annotation[] = $state([...existingAnnotations]);
  let activeTool = $state<AnnotationType>("highlight");
  let activeColor = $state("#facc15");
  let drawing = $state(false);
  let startX = 0;
  let startY = 0;
  let currentAnnotation: Annotation | null = null;
  let imgLoaded = $state(false);

  const tools: { type: AnnotationType; label: string; icon: string }[] = [
    { type: "highlight", label: "Highlight", icon: "▮" },
    { type: "redact", label: "Redact", icon: "■" },
    { type: "arrow", label: "Arrow", icon: "→" },
    { type: "circle", label: "Circle", icon: "○" },
  ];

  const colors = ["#facc15", "#ef4444", "#3b82f6", "#22c55e", "#ffffff"];

  onMount(() => {
    const image = new Image();
    image.onload = () => {
      img = image;
      imgLoaded = true;
      redraw();
    };
    image.src = screenshotUrl;
  });

  function getCanvasCoords(e: MouseEvent): { x: number; y: number } {
    if (!canvas || !img) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = img.width / rect.width;
    const scaleY = img.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX / img.width,
      y: (e.clientY - rect.top) * scaleY / img.height,
    };
  }

  function onMouseDown(e: MouseEvent) {
    const pos = getCanvasCoords(e);
    startX = pos.x;
    startY = pos.y;
    drawing = true;

    currentAnnotation = {
      id: crypto.randomUUID(),
      type: activeTool,
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
      endX: pos.x,
      endY: pos.y,
      color: activeColor,
    };
  }

  function onMouseMove(e: MouseEvent) {
    if (!drawing || !currentAnnotation) return;
    const pos = getCanvasCoords(e);

    if (currentAnnotation.type === "arrow") {
      currentAnnotation.endX = pos.x;
      currentAnnotation.endY = pos.y;
    } else {
      currentAnnotation.x = Math.min(startX, pos.x);
      currentAnnotation.y = Math.min(startY, pos.y);
      currentAnnotation.width = Math.abs(pos.x - startX);
      currentAnnotation.height = Math.abs(pos.y - startY);
    }

    redraw([...annotations, currentAnnotation]);
  }

  function onMouseUp() {
    if (!drawing || !currentAnnotation) return;
    drawing = false;

    const minSize = 0.005;
    const hasSize = currentAnnotation.type === "arrow"
      ? Math.abs((currentAnnotation.endX ?? 0) - startX) > minSize || Math.abs((currentAnnotation.endY ?? 0) - startY) > minSize
      : currentAnnotation.width > minSize || currentAnnotation.height > minSize;

    if (hasSize) {
      annotations = [...annotations, currentAnnotation];
    }
    currentAnnotation = null;
    redraw();
  }

  function redraw(items?: Annotation[]) {
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    renderAnnotations(ctx, items ?? annotations, img.width, img.height);
  }

  function undo() {
    annotations = annotations.slice(0, -1);
    redraw();
  }

  function clearAll() {
    annotations = [];
    redraw();
  }

  function save() {
    onSave(annotations);
  }

  $effect(() => {
    if (imgLoaded) redraw();
  });
</script>

<div class="annotation-overlay">
  <div class="annotation-toolbar">
    <div class="annotation-tools">
      {#each tools as tool}
        <button
          class="annotation-tool-btn"
          class:active={activeTool === tool.type}
          onclick={() => (activeTool = tool.type)}
          title={tool.label}
        >{tool.icon}</button>
      {/each}
    </div>
    <div class="annotation-colors">
      {#each colors as color}
        <button
          class="annotation-color-btn"
          class:active={activeColor === color}
          style="background: {color}"
          onclick={() => (activeColor = color)}
        ></button>
      {/each}
    </div>
    <div class="annotation-actions">
      <button class="small-btn" onclick={undo} disabled={annotations.length === 0}>Undo</button>
      <button class="small-btn" onclick={clearAll} disabled={annotations.length === 0}>Clear</button>
      <button class="small-btn" onclick={save}>Save</button>
      <button class="small-btn" onclick={onClose}>Cancel</button>
    </div>
  </div>
  <div class="annotation-canvas-wrap">
    <canvas
      bind:this={canvas}
      onmousedown={onMouseDown}
      onmousemove={onMouseMove}
      onmouseup={onMouseUp}
      onmouseleave={onMouseUp}
    ></canvas>
  </div>
</div>

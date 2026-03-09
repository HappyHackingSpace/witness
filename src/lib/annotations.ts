export type AnnotationType = "highlight" | "redact" | "arrow" | "circle";

export interface Annotation {
  id: string;
  type: AnnotationType;
  x: number;
  y: number;
  width: number;
  height: number;
  endX?: number;
  endY?: number;
  color: string;
}

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  imgWidth: number,
  imgHeight: number,
): void {
  for (const a of annotations) {
    const x = a.x * imgWidth;
    const y = a.y * imgHeight;
    const w = a.width * imgWidth;
    const h = a.height * imgHeight;

    switch (a.type) {
      case "highlight":
        ctx.fillStyle = a.color + "40";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = a.color + "80";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        break;

      case "redact":
        ctx.fillStyle = "#000000";
        ctx.fillRect(x, y, w, h);
        break;

      case "arrow": {
        const ex = (a.endX ?? a.x) * imgWidth;
        const ey = (a.endY ?? a.y) * imgHeight;
        ctx.strokeStyle = a.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // Arrowhead
        const angle = Math.atan2(ey - y, ex - x);
        const headLen = 12;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
        ctx.stroke();
        break;
      }

      case "circle":
        ctx.strokeStyle = a.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
  }
}

export async function exportAnnotatedScreenshot(
  originalDataUrl: string,
  annotations: Annotation[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      renderAnnotations(ctx, annotations, img.width, img.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = originalDataUrl;
  });
}

import { zipSync, strToU8 } from "fflate";
import type { CaptureMetadata, Case } from "../shared/index.js";
import { captureStore } from "./store.js";
import { generateWarc, type WarcInput } from "./warc.js";

/** Export a single capture as a ZIP evidence package */
export async function exportCapture(capture: CaptureMetadata): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  const domain = safeName(new URL(capture.url).hostname);
  const date = capture.timestamp.slice(0, 10);
  const prefix = `witness_${domain}_${date}`;

  // MHTML content
  const mhtml = await captureStore.getCaptureBlob(capture.id, "mhtml");
  if (mhtml && mhtml instanceof ArrayBuffer) {
    const ext = capture.format === "dom-html" ? "html" : "mhtml";
    files[`${prefix}/content.${ext}`] = new Uint8Array(mhtml);
  }

  // Screenshot
  const screenshot = await captureStore.getCaptureBlob(capture.id, "screenshot");
  if (screenshot && typeof screenshot === "string") {
    const pngData = dataUrlToUint8Array(screenshot);
    files[`${prefix}/screenshot.png`] = pngData;
  }

  // Metadata JSON
  files[`${prefix}/metadata.json`] = strToU8(JSON.stringify(capture, null, 2));

  // Hash verification file
  files[`${prefix}/hashes.txt`] = strToU8(formatHashes(capture));

  const zipped = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), `${prefix}.zip`);
}

/** Export an entire case as a ZIP evidence package */
export async function exportCase(caseData: Case): Promise<void> {
  const captures = await captureStore.getCapturesByCase(caseData.id);
  if (captures.length === 0) {
    throw new Error("No captures in this case");
  }

  const files: Record<string, Uint8Array> = {};
  const caseName = safeName(caseData.name);
  const prefix = `witness_case_${caseName}`;

  // Case metadata
  files[`${prefix}/case.json`] = strToU8(JSON.stringify(caseData, null, 2));

  // Index of all captures
  const index = captures.map((c) => ({
    id: c.id,
    url: c.url,
    title: c.title,
    timestamp: c.timestamp,
    contentHash: c.contentHash,
    evidenceHash: c.evidenceHash,
    format: c.format,
    selectorHits: c.selectorHits.length,
  }));
  files[`${prefix}/index.json`] = strToU8(JSON.stringify(index, null, 2));

  // Each capture in its own subdirectory
  for (const cap of captures) {
    const ts = cap.timestamp.replace(/[:.]/g, "-").slice(0, 19);
    const domain = safeName(new URL(cap.url).hostname);
    const dir = `${prefix}/captures/${ts}_${domain}`;

    // MHTML/HTML content
    const mhtml = await captureStore.getCaptureBlob(cap.id, "mhtml");
    if (mhtml && mhtml instanceof ArrayBuffer) {
      const ext = cap.format === "dom-html" ? "html" : "mhtml";
      files[`${dir}/content.${ext}`] = new Uint8Array(mhtml);
    }

    // Screenshot
    const screenshot = await captureStore.getCaptureBlob(cap.id, "screenshot");
    if (screenshot && typeof screenshot === "string") {
      files[`${dir}/screenshot.png`] = dataUrlToUint8Array(screenshot);
    }

    // Metadata
    files[`${dir}/metadata.json`] = strToU8(JSON.stringify(cap, null, 2));
  }

  // Hash chain verification
  const chainLog = captures
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((c, i) => `${i + 1}. ${c.timestamp} | ${c.url}\n   Evidence: ${c.evidenceHash}\n   Previous: ${c.previousHash ?? "(genesis)"}\n   Content:  ${c.contentHash}`)
    .join("\n\n");
  files[`${prefix}/hash_chain.txt`] = strToU8(`Witness Evidence Hash Chain\nCase: ${caseData.name}\nExported: ${new Date().toISOString()}\nCaptures: ${captures.length}\n\n${chainLog}\n`);

  const zipped = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), `${prefix}.zip`);
}

/** Export all data */
export async function exportAll(): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  const prefix = `witness_export_${new Date().toISOString().slice(0, 10)}`;

  const cases = await captureStore.getAllCases();
  const allCaptures = await captureStore.getRecentCaptures(9999);
  const selectors = await captureStore.getSelectors();

  // Manifest
  files[`${prefix}/manifest.json`] = strToU8(JSON.stringify({
    version: "0.1.0",
    exported: new Date().toISOString(),
    totalCaptures: allCaptures.length,
    totalCases: cases.length,
    totalSelectors: selectors.length,
  }, null, 2));

  files[`${prefix}/cases.json`] = strToU8(JSON.stringify(cases, null, 2));
  files[`${prefix}/selectors.json`] = strToU8(JSON.stringify(selectors, null, 2));

  // All capture metadata (without blobs to keep size manageable)
  files[`${prefix}/captures.json`] = strToU8(JSON.stringify(allCaptures, null, 2));

  // Screenshots only (MHTML would make ZIP too large for full export)
  for (const cap of allCaptures) {
    const screenshot = await captureStore.getCaptureBlob(cap.id, "screenshot");
    if (screenshot && typeof screenshot === "string") {
      const ts = cap.timestamp.replace(/[:.]/g, "-").slice(0, 19);
      const domain = safeName(new URL(cap.url).hostname);
      files[`${prefix}/screenshots/${ts}_${domain}.png`] = dataUrlToUint8Array(screenshot);
    }
  }

  const zipped = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), `${prefix}.zip`);
}

/** Export a single capture as WARC */
export async function exportCaptureWarc(capture: CaptureMetadata): Promise<void> {
  const content = await captureStore.getCaptureBlob(capture.id, "mhtml");
  const screenshot = await captureStore.getCaptureBlob(capture.id, "screenshot");
  const domain = safeName(new URL(capture.url).hostname);
  const date = capture.timestamp.slice(0, 10);
  const filename = `witness_${domain}_${date}.warc.gz`;

  const input: WarcInput = {
    capture,
    content: content instanceof ArrayBuffer ? content : null,
    screenshot: typeof screenshot === "string" ? screenshot : null,
  };

  const warc = generateWarc([input], filename);
  downloadBlob(new Blob([warc as BlobPart], { type: "application/warc" }), filename);
}

/** Export an entire case as WARC */
export async function exportCaseWarc(caseData: Case): Promise<void> {
  const captures = await captureStore.getCapturesByCase(caseData.id);
  if (captures.length === 0) {
    throw new Error("No captures in this case");
  }

  const inputs: WarcInput[] = [];
  for (const cap of captures) {
    const content = await captureStore.getCaptureBlob(cap.id, "mhtml");
    const screenshot = await captureStore.getCaptureBlob(cap.id, "screenshot");
    inputs.push({
      capture: cap,
      content: content instanceof ArrayBuffer ? content : null,
      screenshot: typeof screenshot === "string" ? screenshot : null,
    });
  }

  const caseName = safeName(caseData.name);
  const filename = `witness_case_${caseName}.warc.gz`;
  const warc = generateWarc(inputs, filename);
  downloadBlob(new Blob([warc as BlobPart], { type: "application/warc" }), filename);
}

/** Export all captures as WARC */
export async function exportAllWarc(): Promise<void> {
  const allCaptures = await captureStore.getRecentCaptures(9999);
  const inputs: WarcInput[] = [];

  for (const cap of allCaptures) {
    const content = await captureStore.getCaptureBlob(cap.id, "mhtml");
    const screenshot = await captureStore.getCaptureBlob(cap.id, "screenshot");
    inputs.push({
      capture: cap,
      content: content instanceof ArrayBuffer ? content : null,
      screenshot: typeof screenshot === "string" ? screenshot : null,
    });
  }

  const filename = `witness_export_${new Date().toISOString().slice(0, 10)}.warc.gz`;
  const warc = generateWarc(inputs, filename);
  downloadBlob(new Blob([warc as BlobPart], { type: "application/warc" }), filename);
}

function formatHashes(cap: CaptureMetadata): string {
  return [
    `Witness Evidence Verification`,
    `URL: ${cap.url}`,
    `Title: ${cap.title}`,
    `Captured: ${cap.timestamp}`,
    `Format: ${cap.format}`,
    ``,
    `Content Hash (SHA-256): ${cap.contentHash}`,
    `Screenshot Hash (SHA-256): ${cap.screenshotHash ?? "N/A"}`,
    `Evidence Hash (SHA-256): ${cap.evidenceHash}`,
    `Previous Hash: ${cap.previousHash ?? "(genesis)"}`,
    ``,
    `Browser: ${cap.browser.name} ${cap.browser.version}`,
    `Platform: ${cap.browser.platform}`,
    `User-Agent: ${cap.browser.userAgent}`,
  ].join("\n");
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 50);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

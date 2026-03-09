import type { SHA256Hash } from "./types.js";

/**
 * Compute SHA-256 hash of data using Web Crypto API.
 * Works in all browser contexts: service worker, content script, side panel.
 */
export async function sha256(data: string | ArrayBuffer | Uint8Array): Promise<SHA256Hash> {
  let buffer: ArrayBuffer;

  if (typeof data === "string") {
    buffer = new TextEncoder().encode(data).buffer as ArrayBuffer;
  } else if (data instanceof Uint8Array) {
    buffer = data.buffer as ArrayBuffer;
  } else {
    buffer = data;
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute combined evidence hash from multiple components.
 * Order: contentHash + screenshotHash + metadata JSON + previousHash
 */
export async function computeEvidenceHash(
  contentHash: SHA256Hash,
  screenshotHash: SHA256Hash | null,
  metadataJson: string,
  previousHash: SHA256Hash | null
): Promise<SHA256Hash> {
  const combined = [
    contentHash,
    screenshotHash ?? "null",
    metadataJson,
    previousHash ?? "genesis",
  ].join("|");

  return sha256(combined);
}

/**
 * Verify a capture's integrity by recomputing its evidence hash.
 */
export async function verifyCapture(
  content: ArrayBuffer | string,
  screenshot: ArrayBuffer | null,
  metadataJson: string,
  previousHash: SHA256Hash | null,
  expectedEvidenceHash: SHA256Hash
): Promise<{ valid: boolean; computedHash: SHA256Hash }> {
  const contentHash = await sha256(content);
  const screenshotHash = screenshot ? await sha256(screenshot) : null;
  const computedHash = await computeEvidenceHash(
    contentHash,
    screenshotHash,
    metadataJson,
    previousHash
  );

  return {
    valid: computedHash === expectedEvidenceHash,
    computedHash,
  };
}

import { describe, it, expect } from "vitest";
import { sha256, computeEvidenceHash, verifyCapture } from "./hash.js";

describe("sha256", () => {
  it("hashes a string correctly", async () => {
    const hash = await sha256("hello");
    expect(hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("hashes an empty string", async () => {
    const hash = await sha256("");
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("hashes ArrayBuffer", async () => {
    const buffer = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    const hash = await sha256(buffer);
    expect(hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("hashes Uint8Array", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = await sha256(bytes);
    expect(hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("produces different hashes for different inputs", async () => {
    const hash1 = await sha256("hello");
    const hash2 = await sha256("world");
    expect(hash1).not.toBe(hash2);
  });

  it("returns a 64-character hex string", async () => {
    const hash = await sha256("test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeEvidenceHash", () => {
  it("computes hash from all components", async () => {
    const hash = await computeEvidenceHash(
      "contenthash123",
      "screenshothash456",
      '{"id":"test"}',
      "previoushash789"
    );
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses 'null' for missing screenshot", async () => {
    const hash = await computeEvidenceHash(
      "contenthash123",
      null,
      '{"id":"test"}',
      "previoushash789"
    );
    expect(hash).toHaveLength(64);
  });

  it("uses 'genesis' for first capture in chain", async () => {
    const hash = await computeEvidenceHash(
      "contenthash123",
      "screenshothash456",
      '{"id":"test"}',
      null
    );
    expect(hash).toHaveLength(64);
  });

  it("produces different hashes when any component changes", async () => {
    const base = await computeEvidenceHash("a", "b", "c", "d");
    const diffContent = await computeEvidenceHash("x", "b", "c", "d");
    const diffScreenshot = await computeEvidenceHash("a", "x", "c", "d");
    const diffMeta = await computeEvidenceHash("a", "b", "x", "d");
    const diffPrev = await computeEvidenceHash("a", "b", "c", "x");

    const hashes = [base, diffContent, diffScreenshot, diffMeta, diffPrev];
    const unique = new Set(hashes);
    expect(unique.size).toBe(5);
  });
});

describe("verifyCapture", () => {
  it("verifies a valid capture", async () => {
    const content = "page content";
    const screenshot = new TextEncoder().encode("screenshot").buffer as ArrayBuffer;
    const metadata = '{"id":"test-123"}';
    const previousHash = null;

    const contentHash = await sha256(content);
    const screenshotHash = await sha256(screenshot);
    const expectedHash = await computeEvidenceHash(
      contentHash,
      screenshotHash,
      metadata,
      previousHash
    );

    const result = await verifyCapture(
      content,
      screenshot,
      metadata,
      previousHash,
      expectedHash
    );

    expect(result.valid).toBe(true);
    expect(result.computedHash).toBe(expectedHash);
  });

  it("detects tampered content", async () => {
    const content = "original content";
    const metadata = '{"id":"test"}';

    const contentHash = await sha256(content);
    const expectedHash = await computeEvidenceHash(
      contentHash,
      null,
      metadata,
      null
    );

    const result = await verifyCapture(
      "tampered content",
      null,
      metadata,
      null,
      expectedHash
    );

    expect(result.valid).toBe(false);
  });
});

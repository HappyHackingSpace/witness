import { describe, it, expect } from "vitest";
import { gunzipSync } from "fflate";
import { generateWarc, type WarcInput } from "./warc.js";
import type { CaptureMetadata } from "../shared/index.js";

function makeCapture(overrides?: Partial<CaptureMetadata>): CaptureMetadata {
  return {
    id: "test-id",
    url: "https://example.com/page",
    title: "Test Page",
    timestamp: "2025-01-15T10:30:00.000Z",
    contentHash: "abc123def456",
    screenshotHash: null,
    evidenceHash: "evidence-hash-abc",
    previousHash: null,
    statusCode: 200,
    contentType: "text/html",
    responseHeaders: { "Content-Type": "text/html; charset=utf-8" },
    certificate: null,
    browser: {
      userAgent: "Mozilla/5.0",
      name: "Chrome",
      version: "120",
      platform: "Win32",
      viewport: { width: 1920, height: 1080 },
    },
    referrer: null,
    caseId: "case-1",
    tags: ["test"],
    notes: "Test note",
    selectorHits: [],
    rfc3161Token: null,
    format: "mhtml",
    contentSize: 1234,
    ...overrides,
  };
}

describe("generateWarc", () => {
  it("produces valid gzipped WARC with warcinfo, response, and metadata records", () => {
    const content = new TextEncoder().encode("<html><body>Hello</body></html>");
    const input: WarcInput = {
      capture: makeCapture(),
      content: content.buffer as ArrayBuffer,
      screenshot: null,
    };

    const gzipped = generateWarc([input], "test.warc.gz");
    expect(gzipped).toBeInstanceOf(Uint8Array);
    expect(gzipped.byteLength).toBeGreaterThan(0);

    const raw = gunzipSync(gzipped);
    const text = new TextDecoder().decode(raw);

    expect(text).toContain("WARC/1.1");
    expect(text).toContain("WARC-Type: warcinfo");
    expect(text).toContain("WARC-Type: response");
    expect(text).toContain("WARC-Type: metadata");
    expect(text).toContain("WARC-Target-URI: https://example.com/page");
    expect(text).toContain("WARC-Payload-Digest: sha256:abc123def456");
    expect(text).toContain("Content-Type: application/http;msgtype=response");
    expect(text).toContain("<html><body>Hello</body></html>");
  });

  it("includes resource record for screenshots", () => {
    const content = new TextEncoder().encode("<html></html>");
    const fakeDataUrl = "data:image/png;base64," + btoa("fake-png-data");
    const input: WarcInput = {
      capture: makeCapture({ screenshotHash: "screenshot-hash-123" }),
      content: content.buffer as ArrayBuffer,
      screenshot: fakeDataUrl,
    };

    const gzipped = generateWarc([input], "test.warc.gz");
    const raw = gunzipSync(gzipped);
    const text = new TextDecoder().decode(raw);

    expect(text).toContain("WARC-Type: resource");
    expect(text).toContain("WARC-Target-URI: https://example.com/page#screenshot");
    expect(text).toContain("Content-Type: image/png");
    expect(text).toContain("WARC-Payload-Digest: sha256:screenshot-hash-123");
  });

  it("handles multiple captures", () => {
    const inputs: WarcInput[] = [
      {
        capture: makeCapture({ id: "cap-1", url: "https://example.com/1" }),
        content: new TextEncoder().encode("page 1").buffer as ArrayBuffer,
        screenshot: null,
      },
      {
        capture: makeCapture({ id: "cap-2", url: "https://example.com/2" }),
        content: new TextEncoder().encode("page 2").buffer as ArrayBuffer,
        screenshot: null,
      },
    ];

    const gzipped = generateWarc(inputs, "multi.warc.gz");
    const raw = gunzipSync(gzipped);
    const text = new TextDecoder().decode(raw);

    expect(text).toContain("totalCaptures: 2");
    expect(text).toContain("WARC-Target-URI: https://example.com/1");
    expect(text).toContain("WARC-Target-URI: https://example.com/2");

    const responseCount = (text.match(/WARC-Type: response/g) || []).length;
    expect(responseCount).toBe(2);

    const metadataCount = (text.match(/WARC-Type: metadata/g) || []).length;
    expect(metadataCount).toBe(2);
  });

  it("skips response record when content is null", () => {
    const input: WarcInput = {
      capture: makeCapture(),
      content: null,
      screenshot: null,
    };

    const gzipped = generateWarc([input], "no-content.warc.gz");
    const raw = gunzipSync(gzipped);
    const text = new TextDecoder().decode(raw);

    expect(text).toContain("WARC-Type: warcinfo");
    expect(text).toContain("WARC-Type: metadata");
    expect(text).not.toContain("WARC-Type: response");
  });

  it("includes correct WARC version and record IDs", () => {
    const input: WarcInput = {
      capture: makeCapture(),
      content: new TextEncoder().encode("test").buffer as ArrayBuffer,
      screenshot: null,
    };

    const gzipped = generateWarc([input], "version.warc.gz");
    const raw = gunzipSync(gzipped);
    const text = new TextDecoder().decode(raw);

    const versionMatches = text.match(/WARC\/1\.1/g) || [];
    expect(versionMatches.length).toBeGreaterThanOrEqual(3);

    const recordIdMatches = text.match(/WARC-Record-ID: <urn:uuid:[^>]+>/g) || [];
    expect(recordIdMatches.length).toBeGreaterThanOrEqual(3);

    const uniqueIds = new Set(recordIdMatches);
    expect(uniqueIds.size).toBe(recordIdMatches.length);
  });

  it("includes metadata JSON with capture details", () => {
    const input: WarcInput = {
      capture: makeCapture({ tags: ["osint", "phishing"], notes: "Suspicious page" }),
      content: new TextEncoder().encode("test").buffer as ArrayBuffer,
      screenshot: null,
    };

    const gzipped = generateWarc([input], "meta.warc.gz");
    const raw = gunzipSync(gzipped);
    const text = new TextDecoder().decode(raw);

    expect(text).toContain('"tags"');
    expect(text).toContain('"osint"');
    expect(text).toContain('"phishing"');
    expect(text).toContain('"Suspicious page"');
  });
});

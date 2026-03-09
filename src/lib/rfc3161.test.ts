import { describe, it, expect, vi } from "vitest";

// We test the DER encoding, request building, and response parsing
// by importing the module and exercising the public API

describe("rfc3161", () => {
  // We can't easily test the full TSA flow in unit tests (needs network),
  // but we can test the request building and token parsing

  it("exports requestTimestamp and verifyTimestamp", async () => {
    const mod = await import("./rfc3161.js");
    expect(typeof mod.requestTimestamp).toBe("function");
    expect(typeof mod.verifyTimestamp).toBe("function");
    expect(typeof mod.parseTimestampToken).toBe("function");
  });

  it("requestTimestamp returns null when all TSAs are unreachable", async () => {
    const mod = await import("./rfc3161.js");

    // Mock fetch to simulate network failure
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    try {
      const result = await mod.requestTimestamp(
        "abc123def456abc123def456abc123def456abc123def456abc123def456abcd"
      );
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("verifyTimestamp returns null for invalid base64 token", async () => {
    const mod = await import("./rfc3161.js");
    const result = await mod.verifyTimestamp("not-valid-base64!!!", "somehash");
    expect(result).toBeNull();
  });

  it("parseTimestampToken returns null for empty/invalid data", async () => {
    const mod = await import("./rfc3161.js");
    // Empty base64
    const result = mod.parseTimestampToken(btoa(""));
    expect(result).toBeNull();
  });

  it("parseTimestampToken returns null for garbage data", async () => {
    const mod = await import("./rfc3161.js");
    const result = mod.parseTimestampToken(btoa("this is not ASN.1 data at all"));
    expect(result).toBeNull();
  });

  it("requestTimestamp handles TSA rejection gracefully", async () => {
    const mod = await import("./rfc3161.js");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    try {
      const result = await mod.requestTimestamp(
        "abc123def456abc123def456abc123def456abc123def456abc123def456abcd"
      );
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("requestTimestamp builds valid DER request and sends to TSA", async () => {
    const mod = await import("./rfc3161.js");

    let capturedBody: Uint8Array | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = new Uint8Array(init.body as ArrayBuffer);
      return { ok: false, status: 503 };
    });

    try {
      await mod.requestTimestamp(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );

      // Verify the request was sent
      expect(globalThis.fetch).toHaveBeenCalled();
      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain("freetsa.org");
      expect(options.headers["Content-Type"]).toBe("application/timestamp-query");

      // Verify DER structure: starts with SEQUENCE tag (0x30)
      expect(capturedBody).not.toBeNull();
      expect(capturedBody![0]).toBe(0x30);

      // Should contain SHA-256 OID bytes
      const body = Array.from(capturedBody!);
      const sha256Oid = [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
      const oidStr = sha256Oid.join(",");
      let foundOid = false;
      for (let i = 0; i < body.length - sha256Oid.length; i++) {
        if (body.slice(i, i + sha256Oid.length).join(",") === oidStr) {
          foundOid = true;
          break;
        }
      }
      expect(foundOid).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

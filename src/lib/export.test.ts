import { describe, it, expect } from "vitest";
import { strToU8 } from "fflate";

describe("export utilities", () => {
  it("strToU8 converts string to Uint8Array", () => {
    const result = strToU8("hello");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
  });

  it("strToU8 handles JSON content", () => {
    const json = JSON.stringify({ url: "https://example.com", hash: "abc123" }, null, 2);
    const result = strToU8(json);
    expect(result.length).toBeGreaterThan(0);
    // Decode back to verify
    const decoded = new TextDecoder().decode(result);
    expect(JSON.parse(decoded)).toEqual({ url: "https://example.com", hash: "abc123" });
  });

  it("strToU8 handles unicode content", () => {
    const result = strToU8("Evidence: test@example.com");
    expect(result.length).toBeGreaterThan(0);
    const decoded = new TextDecoder().decode(result);
    expect(decoded).toBe("Evidence: test@example.com");
  });
});

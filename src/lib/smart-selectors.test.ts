import { describe, it, expect } from "vitest";
import { detectPatterns, type SmartMatch } from "./smart-selectors.js";

describe("detectPatterns", () => {
  it("returns empty array for empty text", () => {
    expect(detectPatterns("")).toEqual([]);
  });

  it("returns empty array for text with no patterns", () => {
    expect(detectPatterns("Hello world, nothing to see here.")).toEqual([]);
  });

  // Email detection
  describe("emails", () => {
    it("detects standard email addresses", () => {
      const matches = detectPatterns("Contact us at hello@example.com for info.");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("email");
      expect(matches[0].value).toBe("hello@example.com");
    });

    it("detects multiple emails", () => {
      const matches = detectPatterns("Email alice@test.org or bob@test.co.uk");
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.value)).toContain("alice@test.org");
      expect(matches.map((m) => m.value)).toContain("bob@test.co.uk");
    });

    it("detects emails with plus addressing", () => {
      const matches = detectPatterns("Send to user+tag@example.com please");
      expect(matches).toHaveLength(1);
      expect(matches[0].value).toBe("user+tag@example.com");
    });
  });

  // Phone detection
  describe("phone numbers", () => {
    it("detects international phone with dashes", () => {
      const matches = detectPatterns("Call +1-555-123-4567 now");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
      expect(matches[0].value).toBe("+1-555-123-4567");
    });

    it("detects UK phone number", () => {
      const matches = detectPatterns("Ring +44 20 7946 0958 for support");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });

    it("detects phone with parentheses", () => {
      const matches = detectPatterns("Dial +1 (555) 123-4567 today");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("phone");
    });
  });

  // Crypto address detection
  describe("crypto addresses", () => {
    it("detects Bitcoin legacy address (1...)", () => {
      const addr = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
      const matches = detectPatterns(`Send BTC to ${addr} please`);
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("crypto");
      expect(matches[0].value).toBe(addr);
    });

    it("detects Bitcoin P2SH address (3...)", () => {
      const addr = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
      const matches = detectPatterns(`Pay to ${addr}`);
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("crypto");
    });

    it("detects Bitcoin bech32 address (bc1...)", () => {
      const addr = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
      const matches = detectPatterns(`Wallet: ${addr}`);
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("crypto");
      expect(matches[0].value).toBe(addr);
    });

    it("detects Ethereum address", () => {
      const addr = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08";
      const matches = detectPatterns(`ETH address: ${addr}`);
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("crypto");
      expect(matches[0].value).toBe(addr);
    });
  });

  // IP address detection
  describe("IP addresses", () => {
    it("detects IPv4 address", () => {
      const matches = detectPatterns("Server is at 192.168.1.100 on the LAN");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("ip");
      expect(matches[0].value).toBe("192.168.1.100");
    });

    it("detects multiple IPs", () => {
      const matches = detectPatterns("From 10.0.0.1 to 10.0.0.2 traffic");
      expect(matches).toHaveLength(2);
    });

    it("does not match invalid octets above 255", () => {
      const matches = detectPatterns("Not an IP: 999.999.999.999");
      expect(matches).toHaveLength(0);
    });

    it("detects edge-case IP 0.0.0.0", () => {
      const matches = detectPatterns("Binding to 0.0.0.0 for all interfaces");
      expect(matches).toHaveLength(1);
      expect(matches[0].value).toBe("0.0.0.0");
    });
  });

  // Social handle detection
  describe("social handles", () => {
    it("detects @username", () => {
      const matches = detectPatterns("Follow @johndoe for updates");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("social-handle");
      expect(matches[0].value).toBe("@johndoe");
    });

    it("detects multiple handles", () => {
      const matches = detectPatterns("cc @alice and @bob_123");
      expect(matches).toHaveLength(2);
    });

    it("ignores single-char handles", () => {
      const matches = detectPatterns("at @a alone");
      expect(matches).toHaveLength(0);
    });

    it("does not match @-only", () => {
      const matches = detectPatterns("email @ sign");
      expect(matches).toHaveLength(0);
    });
  });

  // HTML stripping
  describe("HTML handling", () => {
    it("strips HTML tags before scanning", () => {
      const html = '<p>Contact <a href="mailto:a@b.com">a@b.com</a></p>';
      const matches = detectPatterns(html);
      // Should find the email in visible text, not in href attribute
      const emails = matches.filter((m) => m.type === "email");
      expect(emails.length).toBeGreaterThanOrEqual(1);
    });

    it("ignores content inside script tags", () => {
      const html = '<script>var x = "admin@secret.com";</script><p>Hello world</p>';
      const matches = detectPatterns(html);
      expect(matches).toHaveLength(0);
    });

    it("ignores content inside style tags", () => {
      const html = '<style>.foo { background: url("http://192.168.1.1/img.png"); }</style><p>Just text</p>';
      const matches = detectPatterns(html);
      expect(matches).toHaveLength(0);
    });
  });

  // Deduplication
  describe("deduplication", () => {
    it("deduplicates same type+value", () => {
      const text = "Email support@test.com or support@test.com again";
      const matches = detectPatterns(text);
      const emails = matches.filter((m) => m.value === "support@test.com");
      expect(emails).toHaveLength(1);
    });
  });

  // Limit
  describe("limits", () => {
    it("returns at most 50 matches", () => {
      const emails = Array.from({ length: 60 }, (_, i) => `user${i}@example.com`).join(" ");
      const matches = detectPatterns(emails);
      expect(matches.length).toBeLessThanOrEqual(50);
    });
  });

  // Context
  describe("context", () => {
    it("includes surrounding text in context", () => {
      const text = "Please contact admin@example.com for help with your account.";
      const matches = detectPatterns(text);
      expect(matches[0].context).toContain("admin@example.com");
      expect(matches[0].context.length).toBeGreaterThan("admin@example.com".length);
    });

    it("adds ellipsis when context is truncated", () => {
      const text = "A".repeat(50) + " test@example.com " + "B".repeat(50);
      const matches = detectPatterns(text);
      expect(matches[0].context).toMatch(/^\.\.\./);
      expect(matches[0].context).toMatch(/\.\.\.$/);
    });
  });

  // Mixed content
  describe("mixed content", () => {
    it("detects multiple pattern types in one text", () => {
      const text = `
        Contact: admin@example.com
        Phone: +1-555-987-6543
        Server: 10.20.30.40
        BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
        Twitter: @witness_osint
      `;
      const matches = detectPatterns(text);
      const types = new Set(matches.map((m) => m.type));
      expect(types.has("email")).toBe(true);
      expect(types.has("phone")).toBe(true);
      expect(types.has("ip")).toBe(true);
      expect(types.has("crypto")).toBe(true);
      expect(types.has("social-handle")).toBe(true);
    });
  });
});

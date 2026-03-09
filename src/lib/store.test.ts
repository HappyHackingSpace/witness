import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock idb before importing store
vi.mock("idb", () => {
  const stores: Record<string, Map<string, unknown>> = {};

  function getStore(name: string) {
    if (!stores[name]) stores[name] = new Map();
    return stores[name];
  }

  const mockObjectStore = (name: string) => ({
    put: vi.fn((value: Record<string, unknown>) => {
      const key = (value as { id: string }).id;
      getStore(name).set(key, value);
      return Promise.resolve();
    }),
    get: vi.fn((key: string) => {
      return Promise.resolve(getStore(name).get(key));
    }),
    getAll: vi.fn(() => {
      return Promise.resolve([...getStore(name).values()]);
    }),
    delete: vi.fn((key: string) => {
      getStore(name).delete(key);
      return Promise.resolve();
    }),
    count: vi.fn(() => {
      return Promise.resolve(getStore(name).size);
    }),
    index: vi.fn(() => ({
      getAll: vi.fn((key?: string) => {
        if (key === undefined) return Promise.resolve([...getStore(name).values()]);
        return Promise.resolve(
          [...getStore(name).values()].filter(
            (v) => (v as Record<string, unknown>).caseId === key
          )
        );
      }),
    })),
  });

  const mockDB = {
    transaction: vi.fn((_stores: string[]) => {
      const txStores: Record<string, ReturnType<typeof mockObjectStore>> = {};
      for (const s of _stores) txStores[s] = mockObjectStore(s);
      return {
        objectStore: (name: string) => txStores[name],
        done: Promise.resolve(),
      };
    }),
    get: vi.fn((store: string, key: string) => {
      return Promise.resolve(getStore(store).get(key));
    }),
    getAll: vi.fn((store: string) => {
      return Promise.resolve([...getStore(store).values()]);
    }),
    getAllFromIndex: vi.fn((store: string, _index: string, key?: string) => {
      const all = [...getStore(store).values()];
      if (key === undefined || key === null) {
        return Promise.resolve(
          all.filter((v) => (v as Record<string, unknown>).caseId == null)
        );
      }
      return Promise.resolve(
        all.filter((v) => (v as Record<string, unknown>).caseId === key)
      );
    }),
    put: vi.fn((store: string, value: Record<string, unknown>) => {
      const key = (value as { id: string }).id;
      getStore(store).set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((store: string, key: string) => {
      getStore(store).delete(key);
      return Promise.resolve();
    }),
    count: vi.fn((store: string) => {
      return Promise.resolve(getStore(store).size);
    }),
    objectStoreNames: { contains: () => false },
  };

  return {
    openDB: vi.fn(() => Promise.resolve(mockDB)),
  };
});

// Mock shared constants
vi.mock("../shared/index.js", () => ({
  DB_NAME: "witness_test",
  DB_VERSION: 1,
  STORES: {
    CAPTURES: "captures",
    CASES: "cases",
    SELECTORS: "selectors",
    BLOBS: "blobs",
  },
}));

const { captureStore } = await import("./store.js");

describe("CaptureStore", () => {
  describe("cases", () => {
    it("should create and retrieve a case", async () => {
      const testCase = {
        id: "case-1",
        name: "Test Case",
        description: "A test investigation",
        investigator: "tester",
        caseNumber: "TC-001",
        createdAt: "2026-03-09T00:00:00Z",
        updatedAt: "2026-03-09T00:00:00Z",
        tags: ["test"],
        captureCount: 0,
        storageUsed: 0,
      };

      await captureStore.createCase(testCase);
      const retrieved = await captureStore.getCase("case-1");
      expect(retrieved).toEqual(testCase);
    });

    it("should list all cases", async () => {
      const cases = await captureStore.getAllCases();
      expect(cases.length).toBeGreaterThanOrEqual(1);
    });

    it("should delete a case", async () => {
      await captureStore.deleteCase("case-1");
      const retrieved = await captureStore.getCase("case-1");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("selectors", () => {
    it("should create and retrieve a selector", async () => {
      const selector = {
        id: "sel-1",
        name: "Test Email",
        pattern: "test@example.com",
        type: "email" as const,
        isRegex: false,
        enabled: true,
        caseId: null,
        createdAt: "2026-03-09T00:00:00Z",
        hitCount: 0,
      };

      await captureStore.saveSelector(selector);
      const all = await captureStore.getSelectors();
      expect(all.some((s) => s.id === "sel-1")).toBe(true);
    });

    it("should delete a selector", async () => {
      await captureStore.deleteSelector("sel-1");
      const all = await captureStore.getSelectors();
      expect(all.some((s) => s.id === "sel-1")).toBe(false);
    });
  });

  describe("stats", () => {
    it("should return stats", async () => {
      const stats = await captureStore.getStats();
      expect(stats).toHaveProperty("totalCaptures");
      expect(stats).toHaveProperty("totalCases");
      expect(stats).toHaveProperty("totalSelectors");
    });
  });
});

import { openDB, type IDBPDatabase } from "idb";
import { DB_NAME, DB_VERSION, STORES } from "../shared/index.js";
import type { CaptureMetadata, Case, Selector } from "../shared/index.js";

interface WitnessDB {
  [STORES.CAPTURES]: {
    key: string;
    value: CaptureMetadata;
    indexes: {
      "by-case": string;
      "by-url": string;
      "by-timestamp": string;
    };
  };
  [STORES.CASES]: {
    key: string;
    value: Case;
  };
  [STORES.SELECTORS]: {
    key: string;
    value: Selector;
    indexes: {
      "by-case": string | null;
    };
  };
  [STORES.BLOBS]: {
    key: string;
    value: {
      id: string;
      type: "mhtml" | "screenshot" | "warc" | "annotations" | "search";
      data: ArrayBuffer | string;
    };
  };
}

class CaptureStore {
  private dbPromise: Promise<IDBPDatabase<WitnessDB>> | null = null;

  private getDB(): Promise<IDBPDatabase<WitnessDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<WitnessDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          // Captures store
          if (!db.objectStoreNames.contains(STORES.CAPTURES)) {
            const captureStore = db.createObjectStore(STORES.CAPTURES, {
              keyPath: "id",
            });
            captureStore.createIndex("by-case", "caseId");
            captureStore.createIndex("by-url", "url");
            captureStore.createIndex("by-timestamp", "timestamp");
          }

          // Cases store
          if (!db.objectStoreNames.contains(STORES.CASES)) {
            db.createObjectStore(STORES.CASES, { keyPath: "id" });
          }

          // Selectors store
          if (!db.objectStoreNames.contains(STORES.SELECTORS)) {
            const selectorStore = db.createObjectStore(STORES.SELECTORS, {
              keyPath: "id",
            });
            selectorStore.createIndex("by-case", "caseId");
          }

          // Blobs store (MHTML, screenshots)
          if (!db.objectStoreNames.contains(STORES.BLOBS)) {
            db.createObjectStore(STORES.BLOBS, { keyPath: "id" });
          }
        },
      });
    }
    return this.dbPromise;
  }

  // --- Captures ---

  async saveCapture(
    metadata: CaptureMetadata,
    mhtmlData: ArrayBuffer,
    screenshotDataUrl: string | null
  ): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction([STORES.CAPTURES, STORES.BLOBS], "readwrite");

    await tx.objectStore(STORES.CAPTURES).put(metadata);
    await tx.objectStore(STORES.BLOBS).put({
      id: `mhtml:${metadata.id}`,
      type: "mhtml",
      data: mhtmlData,
    });

    if (screenshotDataUrl) {
      await tx.objectStore(STORES.BLOBS).put({
        id: `screenshot:${metadata.id}`,
        type: "screenshot",
        data: screenshotDataUrl,
      });
    }

    await tx.done;
  }

  async getCapture(id: string): Promise<CaptureMetadata | undefined> {
    const db = await this.getDB();
    return db.get(STORES.CAPTURES, id);
  }

  async getCapturesByCase(caseId: string): Promise<CaptureMetadata[]> {
    const db = await this.getDB();
    return db.getAllFromIndex(STORES.CAPTURES, "by-case", caseId);
  }

  async getRecentCaptures(limit: number = 50): Promise<CaptureMetadata[]> {
    const db = await this.getDB();
    const all = await db.getAllFromIndex(STORES.CAPTURES, "by-timestamp");
    return all.reverse().slice(0, limit);
  }

  async updateCapture(id: string, updates: Partial<CaptureMetadata>): Promise<void> {
    const db = await this.getDB();
    const existing = await db.get(STORES.CAPTURES, id);
    if (!existing) return;
    const updated = { ...existing, ...updates, id: existing.id };
    await db.put(STORES.CAPTURES, updated);
  }

  async deleteCapture(id: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction([STORES.CAPTURES, STORES.BLOBS], "readwrite");
    await tx.objectStore(STORES.CAPTURES).delete(id);
    await tx.objectStore(STORES.BLOBS).delete(`mhtml:${id}`);
    await tx.objectStore(STORES.BLOBS).delete(`screenshot:${id}`);
    await tx.done;
  }

  async getCaptureBlob(
    captureId: string,
    type: "mhtml" | "screenshot"
  ): Promise<ArrayBuffer | string | null> {
    const db = await this.getDB();
    const blob = await db.get(STORES.BLOBS, `${type}:${captureId}`);
    return blob?.data ?? null;
  }

  async saveAnnotations(captureId: string, annotations: unknown[]): Promise<void> {
    const db = await this.getDB();
    await db.put(STORES.BLOBS, {
      id: `annotations:${captureId}`,
      type: "annotations" as const,
      data: JSON.stringify(annotations),
    });
  }

  async getAnnotations(captureId: string): Promise<unknown[]> {
    const db = await this.getDB();
    const blob = await db.get(STORES.BLOBS, `annotations:${captureId}`);
    if (blob && typeof blob.data === "string") {
      try { return JSON.parse(blob.data); } catch { return []; }
    }
    return [];
  }

  async saveSearchDocument(doc: {
    captureId: string;
    url: string;
    title: string;
    text: string;
    timestamp: string;
    caseId: string;
  }): Promise<void> {
    const db = await this.getDB();
    await db.put(STORES.BLOBS, {
      id: `search:${doc.captureId}`,
      type: "search" as const,
      data: JSON.stringify(doc),
    });
  }

  async getSearchDocuments(caseId?: string): Promise<Array<{
    captureId: string;
    url: string;
    title: string;
    text: string;
    timestamp: string;
    caseId: string;
  }>> {
    const db = await this.getDB();
    const all = await db.getAll(STORES.BLOBS);
    const docs: Array<any> = [];
    for (const blob of all) {
      if (blob.type !== "search" || typeof blob.data !== "string") continue;
      try {
        const doc = JSON.parse(blob.data);
        if (caseId && doc.caseId !== caseId) continue;
        docs.push(doc);
      } catch { /* skip */ }
    }
    return docs;
  }

  async deleteSearchDocument(captureId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(STORES.BLOBS, `search:${captureId}`);
  }

  // --- Cases ---

  async createCase(caseData: Case): Promise<void> {
    const db = await this.getDB();
    await db.put(STORES.CASES, caseData);
  }

  async getCase(id: string): Promise<Case | undefined> {
    const db = await this.getDB();
    return db.get(STORES.CASES, id);
  }

  async getAllCases(): Promise<Case[]> {
    const db = await this.getDB();
    return db.getAll(STORES.CASES);
  }

  async deleteCase(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(STORES.CASES, id);
  }

  // --- Selectors ---

  async saveSelector(selector: Selector): Promise<void> {
    const db = await this.getDB();
    await db.put(STORES.SELECTORS, selector);
  }

  async getSelectors(caseId?: string): Promise<Selector[]> {
    const db = await this.getDB();
    if (caseId) {
      const caseSelectors = await db.getAllFromIndex(STORES.SELECTORS, "by-case", caseId);
      const globalSelectors = await db.getAllFromIndex(STORES.SELECTORS, "by-case", null);
      return [...globalSelectors, ...caseSelectors];
    }
    return db.getAll(STORES.SELECTORS);
  }

  async deleteSelector(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(STORES.SELECTORS, id);
  }

  // --- Stats ---

  async getStats(): Promise<{
    totalCaptures: number;
    totalCases: number;
    totalSelectors: number;
  }> {
    const db = await this.getDB();
    return {
      totalCaptures: await db.count(STORES.CAPTURES),
      totalCases: await db.count(STORES.CASES),
      totalSelectors: await db.count(STORES.SELECTORS),
    };
  }
}

export const captureStore = new CaptureStore();

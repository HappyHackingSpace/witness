import { captureStore } from "./store.js";

export interface SearchResult {
  captureId: string;
  url: string;
  title: string;
  timestamp: string;
  snippets: string[];
  matchCount: number;
}

export async function indexCapture(
  captureId: string,
  url: string,
  title: string,
  text: string,
  timestamp: string,
  caseId: string,
): Promise<void> {
  await captureStore.saveSearchDocument({
    captureId,
    url,
    title,
    text,
    timestamp,
    caseId,
  });
}

export async function searchContent(
  query: string,
  caseId?: string | null,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const docs = await captureStore.getSearchDocuments(caseId ?? undefined);
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const doc of docs) {
    const text = doc.text.toLowerCase();
    let idx = text.indexOf(q);
    if (idx === -1) continue;

    const snippets: string[] = [];
    let count = 0;
    while (idx !== -1 && count < 5) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(doc.text.length, idx + q.length + 40);
      let snippet = doc.text.slice(start, end).trim();
      if (start > 0) snippet = "..." + snippet;
      if (end < doc.text.length) snippet = snippet + "...";
      snippets.push(snippet);
      count++;
      idx = text.indexOf(q, idx + q.length);
    }

    // Count remaining matches
    while (idx !== -1) {
      count++;
      idx = text.indexOf(q, idx + q.length);
    }

    results.push({
      captureId: doc.captureId,
      url: doc.url,
      title: doc.title,
      timestamp: doc.timestamp,
      snippets,
      matchCount: count,
    });
  }

  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}

export function deleteSearchIndex(captureId: string): Promise<void> {
  return captureStore.deleteSearchDocument(captureId);
}

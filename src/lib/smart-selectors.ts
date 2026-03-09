export interface SmartMatch {
  type: "email" | "phone" | "crypto" | "ip" | "social-handle";
  value: string;
  context: string;
}

const MAX_MATCHES = 50;
const CONTEXT_RADIUS = 20;

const PATTERNS: { type: SmartMatch["type"]; regex: RegExp }[] = [
  {
    type: "email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: "phone",
    regex: /\+[1-9]\d{0,2}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g,
  },
  {
    type: "crypto",
    regex: /(?:(?:1|3)[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,62}|0x[0-9a-fA-F]{40}|4[0-9AB][1-9A-HJ-NP-Za-km-z]{93})/g,
  },
  {
    type: "ip",
    regex: /(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)/g,
  },
  {
    type: "social-handle",
    regex: /(?<=\s|^)@[a-zA-Z_][a-zA-Z0-9_.]{1,30}(?=[\s,.:;!?)}\]"']|$)/gm,
  },
];

function stripHtmlTagsAndScripts(html: string): string {
  let text = html;
  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ");
  return text;
}

function extractContext(text: string, start: number, end: number): string {
  const ctxStart = Math.max(0, start - CONTEXT_RADIUS);
  const ctxEnd = Math.min(text.length, end + CONTEXT_RADIUS);
  let ctx = text.slice(ctxStart, ctxEnd).trim();
  if (ctxStart > 0) ctx = "..." + ctx;
  if (ctxEnd < text.length) ctx = ctx + "...";
  return ctx;
}

export function detectPatterns(text: string): SmartMatch[] {
  const cleanText = stripHtmlTagsAndScripts(text);
  const seen = new Set<string>();
  const matches: SmartMatch[] = [];

  for (const { type, regex } of PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(cleanText)) !== null) {
      if (matches.length >= MAX_MATCHES) return matches;

      const value = match[0].trim();

      // Phone numbers must have at least 7 digits total
      if (type === "phone") {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) continue;
      }

      const key = `${type}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const context = extractContext(cleanText, match.index, match.index + value.length);
      matches.push({ type, value, context });
    }
  }

  return matches;
}

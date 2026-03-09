import { gzipSync, strToU8 } from "fflate";
import type { CaptureMetadata } from "../shared/index.js";

const CRLF = "\r\n";
const WARC_VERSION = "WARC/1.1";

function warcDate(iso?: string): string {
  return (iso ? new Date(iso) : new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function warcRecordId(): string {
  return `<urn:uuid:${crypto.randomUUID()}>`;
}

function buildRecord(headers: [string, string][], payload: Uint8Array): Uint8Array {
  const headerBlock = [
    WARC_VERSION,
    ...headers.map(([k, v]) => `${k}: ${v}`),
    `Content-Length: ${payload.byteLength}`,
    "",
    "",
  ].join(CRLF);

  const headerBytes = strToU8(headerBlock);
  const trailer = strToU8(CRLF + CRLF);
  const record = new Uint8Array(headerBytes.byteLength + payload.byteLength + trailer.byteLength);
  record.set(headerBytes, 0);
  record.set(payload, headerBytes.byteLength);
  record.set(trailer, headerBytes.byteLength + payload.byteLength);
  return record;
}

function warcinfoRecord(filename: string, captures: number): Uint8Array {
  const fields = [
    `software: Witness Evidence Capture Extension`,
    `format: WARC File Format 1.1`,
    `conformsTo: http://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/`,
    `totalCaptures: ${captures}`,
    `exportDate: ${warcDate()}`,
    "",
  ].join(CRLF);
  const payload = strToU8(fields);

  return buildRecord(
    [
      ["WARC-Type", "warcinfo"],
      ["WARC-Date", warcDate()],
      ["WARC-Filename", filename],
      ["WARC-Record-ID", warcRecordId()],
      ["Content-Type", "application/warc-fields"],
    ],
    payload,
  );
}

function responseRecord(capture: CaptureMetadata, content: Uint8Array): Uint8Array {
  const httpStatus = capture.statusCode ?? 200;
  const contentType = capture.contentType ?? "text/html";

  const httpHeader = [
    `HTTP/1.1 ${httpStatus} OK`,
    `Content-Type: ${contentType}`,
    ...Object.entries(capture.responseHeaders).map(([k, v]) => `${k}: ${v}`),
    "",
    "",
  ].join(CRLF);
  const httpHeaderBytes = strToU8(httpHeader);

  const payload = new Uint8Array(httpHeaderBytes.byteLength + content.byteLength);
  payload.set(httpHeaderBytes, 0);
  payload.set(content, httpHeaderBytes.byteLength);

  return buildRecord(
    [
      ["WARC-Type", "response"],
      ["WARC-Date", warcDate(capture.timestamp)],
      ["WARC-Target-URI", capture.url],
      ["WARC-Record-ID", warcRecordId()],
      ["WARC-Payload-Digest", `sha256:${capture.contentHash}`],
      ["Content-Type", "application/http;msgtype=response"],
    ],
    payload,
  );
}

function resourceRecord(
  targetUri: string,
  date: string,
  mimeType: string,
  data: Uint8Array,
  digest?: string,
): Uint8Array {
  const headers: [string, string][] = [
    ["WARC-Type", "resource"],
    ["WARC-Date", warcDate(date)],
    ["WARC-Target-URI", targetUri],
    ["WARC-Record-ID", warcRecordId()],
    ["Content-Type", mimeType],
  ];
  if (digest) {
    headers.push(["WARC-Payload-Digest", `sha256:${digest}`]);
  }
  return buildRecord(headers, data);
}

function metadataRecord(capture: CaptureMetadata): Uint8Array {
  const meta: Record<string, unknown> = {
    id: capture.id,
    title: capture.title,
    timestamp: capture.timestamp,
    contentHash: capture.contentHash,
    screenshotHash: capture.screenshotHash,
    evidenceHash: capture.evidenceHash,
    previousHash: capture.previousHash,
    format: capture.format,
    contentSize: capture.contentSize,
    browser: capture.browser,
    certificate: capture.certificate,
    referrer: capture.referrer,
    caseId: capture.caseId,
    tags: capture.tags,
    notes: capture.notes,
    selectorHits: capture.selectorHits,
  };
  const payload = strToU8(JSON.stringify(meta, null, 2));

  return buildRecord(
    [
      ["WARC-Type", "metadata"],
      ["WARC-Date", warcDate(capture.timestamp)],
      ["WARC-Target-URI", capture.url],
      ["WARC-Record-ID", warcRecordId()],
      ["Content-Type", "application/json"],
    ],
    payload,
  );
}

function concatRecords(records: Uint8Array[]): Uint8Array {
  const total = records.reduce((sum, r) => sum + r.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const r of records) {
    result.set(r, offset);
    offset += r.byteLength;
  }
  return result;
}

export interface WarcInput {
  capture: CaptureMetadata;
  content: ArrayBuffer | null;
  screenshot: string | null;
}

/** Generate a WARC 1.1 file from one or more captures. Returns gzipped WARC bytes. */
export function generateWarc(inputs: WarcInput[], filename: string): Uint8Array {
  const records: Uint8Array[] = [];

  records.push(warcinfoRecord(filename, inputs.length));

  for (const { capture, content, screenshot } of inputs) {
    if (content) {
      records.push(responseRecord(capture, new Uint8Array(content)));
    }

    if (screenshot) {
      const base64 = screenshot.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const mime = screenshot.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      records.push(
        resourceRecord(
          `${capture.url}#screenshot`,
          capture.timestamp,
          mime,
          bytes,
          capture.screenshotHash ?? undefined,
        ),
      );
    }

    records.push(metadataRecord(capture));
  }

  const warc = concatRecords(records);
  return gzipSync(warc, { level: 6 });
}

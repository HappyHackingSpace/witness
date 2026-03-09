/** Unique identifier for a capture */
export type CaptureId = string;

/** Unique identifier for a case */
export type CaseId = string;

/** Unique identifier for a selector */
export type SelectorId = string;

/** SHA-256 hash hex string */
export type SHA256Hash = string;

/** Capture metadata collected at the moment of evidence acquisition */
export interface CaptureMetadata {
  /** Unique capture identifier (UUIDv4) */
  id: CaptureId;

  /** Full URL of the captured page */
  url: string;

  /** Page title at time of capture */
  title: string;

  /** UTC timestamp of capture (ISO 8601) */
  timestamp: string;

  /** SHA-256 hash of the captured content (MHTML or DOM HTML) */
  contentHash: SHA256Hash;

  /** SHA-256 hash of the full-page screenshot */
  screenshotHash: SHA256Hash | null;

  /** Combined evidence hash (content + screenshot + metadata) */
  evidenceHash: SHA256Hash;

  /** Previous capture's evidence hash (forms tamper-evident chain) */
  previousHash: SHA256Hash | null;

  /** HTTP response status code */
  statusCode: number | null;

  /** Content-Type from HTTP response */
  contentType: string | null;

  /** HTTP response headers (selected, privacy-safe subset) */
  responseHeaders: Record<string, string>;

  /** SSL/TLS certificate info */
  certificate: CertificateInfo | null;

  /** Browser metadata */
  browser: BrowserInfo;

  /** Referrer URL (how investigator reached this page) */
  referrer: string | null;

  /** Case this capture belongs to */
  caseId: CaseId;

  /** User-applied tags */
  tags: string[];

  /** User notes */
  notes: string;

  /** Selector hits found on this page */
  selectorHits: SelectorHit[];

  /** RFC 3161 timestamp token (base64-encoded, if available) */
  rfc3161Token: string | null;

  /** Capture format */
  format: "mhtml" | "dom-html" | "warc";

  /** Size of captured content in bytes */
  contentSize: number;
}

export interface CertificateInfo {
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
  protocol: string;
}

export interface BrowserInfo {
  userAgent: string;
  name: string;
  version: string;
  platform: string;
  viewport: { width: number; height: number };
}

export interface Case {
  id: CaseId;
  name: string;
  description: string;
  investigator: string;
  caseNumber: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  captureCount: number;
  storageUsed: number;
}

export interface Selector {
  id: SelectorId;
  name: string;
  pattern: string;
  type: SelectorType;
  isRegex: boolean;
  enabled: boolean;
  caseId: CaseId | null;
  createdAt: string;
  hitCount: number;
}

export type SelectorType =
  | "username"
  | "email"
  | "phone"
  | "crypto"
  | "keyword"
  | "custom";

export interface SelectorHit {
  selectorId: SelectorId;
  selectorName: string;
  matchedText: string;
  context: string;
  location: "visible" | "source" | "metadata";
}

/** Extension → App sync payload */
export interface SyncPayload {
  captures: CaptureMetadata[];
  cases: Case[];
  selectors: Selector[];
}

/** Extension settings */
export interface WitnessSettings {
  captureMode: "automatic" | "manual" | "selective";
  captureScreenshot: boolean;
  captureFullPage: boolean;
  domainRules: DomainRule[];
  maxCaptureSize: number;
  retentionDays: number;
  appUrl: string | null;
  syncEnabled: boolean;
  notifications: {
    selectorHit: boolean;
    captureComplete: boolean;
    sound: boolean;
  };
}

export interface DomainRule {
  pattern: string;
  action: "allow" | "block";
}

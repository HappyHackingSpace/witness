/** Database names for IndexedDB stores */
export const DB_NAME = "witness";
export const DB_VERSION = 1;

/** IndexedDB store names */
export const STORES = {
  CAPTURES: "captures",
  CASES: "cases",
  SELECTORS: "selectors",
  BLOBS: "blobs",
} as const;

/** chrome.storage keys */
export const STORAGE_KEYS = {
  SETTINGS: "witness_settings",
  ACTIVE_CASE: "witness_active_case",
  CAPTURE_ENABLED: "witness_capture_enabled",
  LAST_HASH: "witness_last_hash",
  DOMAIN_RULES: "witness_domain_rules",
  CAPTURE_MODE: "witness_capture_mode",
  FULLPAGE_SCREENSHOT: "witness_fullpage_screenshot",
  SMART_DETECTION: "witness_smart_detection",
} as const;

/** Default extension settings */
export const DEFAULT_SETTINGS = {
  captureMode: "automatic" as const,
  captureScreenshot: true,
  captureFullPage: false,
  domainRules: [] as Array<{ pattern: string; action: "allow" | "block" }>,
  maxCaptureSize: 50 * 1024 * 1024, // 50 MB
  retentionDays: 365,
  appUrl: null as string | null,
  syncEnabled: false,
  notifications: {
    selectorHit: true,
    captureComplete: false,
    sound: false,
  },
};

/** URLs to always skip capturing */
export const SKIP_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^about:/,
  /^edge:\/\//,
  /^brave:\/\//,
  /^moz-extension:\/\//,
  /^devtools:\/\//,
  /^view-source:/,
] as const;

/** Witness file extension for evidence packages */
export const WITNESS_PACKAGE_EXTENSION = ".witness";

/** Maximum selector context chars to capture around a hit */
export const SELECTOR_CONTEXT_CHARS = 200;

/** API paths for Witness App */
export const API_PATHS = {
  SYNC: "/api/sync",
  CAPTURES: "/api/captures",
  CASES: "/api/cases",
  SELECTORS: "/api/selectors",
  SEARCH: "/api/search",
  EXPORT: "/api/export",
  VERIFY: "/api/verify",
  AUTH: "/api/auth",
  HEALTH: "/api/health",
} as const;

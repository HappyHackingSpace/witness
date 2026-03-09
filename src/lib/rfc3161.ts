/**
 * RFC 3161 Trusted Timestamps
 *
 * Submits SHA-256 evidence hashes to a Time Stamping Authority (TSA)
 * and stores the signed timestamp token for legal defensibility.
 */

// ASN.1 DER tag constants
const TAG_INTEGER = 0x02;
const TAG_OCTET_STRING = 0x04;
const TAG_NULL = 0x05;
const TAG_OID = 0x06;
const TAG_GENERALIZED_TIME = 0x18;
const TAG_SEQUENCE = 0x30;
const TAG_BOOLEAN = 0x01;

// SHA-256 OID: 2.16.840.1.101.3.4.2.1
const SHA256_OID = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

// TSA endpoints (tried in order)
const TSA_ENDPOINTS = [
  "https://freetsa.org/tsr",
  "https://timestamp.digicert.com",
];

// --- Minimal DER encoder ---

function derLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derTlv(tag: number, value: Uint8Array): Uint8Array {
  const len = derLength(value.byteLength);
  const result = new Uint8Array(1 + len.byteLength + value.byteLength);
  result[0] = tag;
  result.set(len, 1);
  result.set(value, 1 + len.byteLength);
  return result;
}

function derSequence(...items: Uint8Array[]): Uint8Array {
  const total = items.reduce((s, i) => s + i.byteLength, 0);
  const content = new Uint8Array(total);
  let offset = 0;
  for (const item of items) {
    content.set(item, offset);
    offset += item.byteLength;
  }
  return derTlv(TAG_SEQUENCE, content);
}

function derInteger(value: number): Uint8Array {
  if (value < 0x80) return derTlv(TAG_INTEGER, new Uint8Array([value]));
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return derTlv(TAG_INTEGER, new Uint8Array(bytes));
}

function derIntegerBigBytes(bytes: Uint8Array): Uint8Array {
  // Ensure positive (prepend 0 if high bit set)
  if (bytes[0] & 0x80) {
    const padded = new Uint8Array(bytes.byteLength + 1);
    padded.set(bytes, 1);
    return derTlv(TAG_INTEGER, padded);
  }
  return derTlv(TAG_INTEGER, bytes);
}

function derOid(oid: Uint8Array): Uint8Array {
  return derTlv(TAG_OID, oid);
}

function derOctetString(data: Uint8Array): Uint8Array {
  return derTlv(TAG_OCTET_STRING, data);
}

function derNull(): Uint8Array {
  return new Uint8Array([TAG_NULL, 0x00]);
}

function derBoolean(value: boolean): Uint8Array {
  return derTlv(TAG_BOOLEAN, new Uint8Array([value ? 0xff : 0x00]));
}

// --- DER parser ---

interface DerNode {
  tag: number;
  constructed: boolean;
  value: Uint8Array;
  children?: DerNode[];
  offset: number;
  totalLength: number;
}

function parseDer(data: Uint8Array, pos = 0): DerNode {
  const tag = data[pos];
  const constructed = (tag & 0x20) !== 0;
  let offset = pos + 1;

  // Parse length
  let length: number;
  if (data[offset] < 0x80) {
    length = data[offset];
    offset++;
  } else {
    const numBytes = data[offset] & 0x7f;
    offset++;
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | data[offset + i];
    }
    offset += numBytes;
  }

  const value = data.subarray(offset, offset + length);
  const totalLength = offset + length - pos;

  const node: DerNode = { tag, constructed, value, offset, totalLength };

  if (constructed) {
    node.children = [];
    let childPos = 0;
    while (childPos < value.byteLength) {
      const child = parseDer(value, childPos);
      node.children.push(child);
      childPos += child.totalLength;
    }
  }

  return node;
}

function findByTag(node: DerNode, tag: number): DerNode | null {
  if (node.tag === tag) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findByTag(child, tag);
      if (found) return found;
    }
  }
  return null;
}

function findAllByTag(node: DerNode, tag: number, results: DerNode[] = []): DerNode[] {
  if (node.tag === tag) results.push(node);
  if (node.children) {
    for (const child of node.children) {
      findAllByTag(child, tag, results);
    }
  }
  return results;
}

// --- Hex helpers ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Build TimeStampReq ---

function buildTimeStampReq(hashHex: string): Uint8Array {
  const hashBytes = hexToBytes(hashHex);

  // AlgorithmIdentifier: SEQUENCE { OID(SHA-256), NULL }
  const algId = derSequence(derOid(SHA256_OID), derNull());

  // MessageImprint: SEQUENCE { AlgorithmIdentifier, OCTET STRING(hash) }
  const messageImprint = derSequence(algId, derOctetString(hashBytes));

  // Nonce: random 8 bytes as INTEGER
  const nonceBytes = new Uint8Array(8);
  crypto.getRandomValues(nonceBytes);
  const nonce = derIntegerBigBytes(nonceBytes);

  // certReq: BOOLEAN TRUE (request TSA certificate in response)
  const certReq = derBoolean(true);

  // TimeStampReq: SEQUENCE { version(1), messageImprint, nonce, certReq }
  return derSequence(derInteger(1), messageImprint, nonce, certReq);
}

// --- Parse TimeStampResp ---

interface TsaResponse {
  status: number;
  statusString?: string;
  token: Uint8Array | null;
}

function parseTimeStampResp(data: Uint8Array): TsaResponse {
  const root = parseDer(data);
  if (!root.children || root.children.length < 1) {
    throw new Error("Invalid TimeStampResp: missing PKIStatusInfo");
  }

  // PKIStatusInfo is the first SEQUENCE child
  const statusInfo = root.children[0];
  if (!statusInfo.children || statusInfo.children.length < 1) {
    throw new Error("Invalid PKIStatusInfo");
  }

  // PKIStatus is the first INTEGER in PKIStatusInfo
  const statusNode = statusInfo.children[0];
  const status = statusNode.value[0];

  let statusString: string | undefined;
  if (statusInfo.children.length > 1 && statusInfo.children[1].tag === TAG_SEQUENCE) {
    // PKIFreeText - try to decode as UTF8
    const textNode = findByTag(statusInfo.children[1], 0x0c); // UTF8String
    if (textNode) {
      statusString = new TextDecoder().decode(textNode.value);
    }
  }

  // TimeStampToken is the second element (if status is granted)
  let token: Uint8Array | null = null;
  if (root.children.length > 1 && (status === 0 || status === 1)) {
    // Re-encode the token child as-is (it's the complete ContentInfo)
    const tokenNode = root.children[1];
    token = data.subarray(
      tokenNode.offset - (tokenNode.totalLength - tokenNode.value.byteLength),
      tokenNode.offset + tokenNode.value.byteLength,
    );
    // Actually, we need from the start of the tag. Let's compute correctly.
    // The offset in tokenNode is where the value starts. We need from tag byte.
    // Since root's value starts at root.offset, child positions are relative.
    // Let's just use a simpler approach: take everything after statusInfo.
    const statusInfoEnd = statusInfo.totalLength;
    token = root.value.subarray(statusInfoEnd);
  }

  return { status, statusString, token };
}

// --- Extract info from token ---

export interface TimestampInfo {
  genTime: string;
  serialNumber: string;
  tsaName: string | null;
  hashAlgorithm: string;
  hashedMessage: string;
  raw: string; // base64 of full token
}

function decodeGeneralizedTime(value: Uint8Array): string {
  const str = new TextDecoder().decode(value);
  // Format: YYYYMMDDHHmmSS[.fraction]Z
  if (str.length >= 14) {
    const y = str.substring(0, 4);
    const m = str.substring(4, 6);
    const d = str.substring(6, 8);
    const h = str.substring(8, 10);
    const min = str.substring(10, 12);
    const s = str.substring(12, 14);
    const frac = str.substring(14).replace("Z", "");
    return `${y}-${m}-${d}T${h}:${min}:${s}${frac}Z`;
  }
  return str;
}

export function parseTimestampToken(base64Token: string): TimestampInfo | null {
  try {
    const data = base64ToBytes(base64Token);
    if (data.byteLength < 20) return null;

    const root = parseDer(data);

    // Must be a SEQUENCE (ContentInfo) with at least 2 children (contentType OID + content)
    if (root.tag !== TAG_SEQUENCE || !root.children || root.children.length < 2) return null;
    // First child must be an OID
    if (root.children[0].tag !== TAG_OID) return null;

    // ContentInfo -> SignedData -> encapContentInfo -> eContent -> TSTInfo
    // Navigate: SEQUENCE { OID, [0] EXPLICIT { SignedData } }
    // SignedData: SEQUENCE { version, digestAlgorithms, encapContentInfo, ... }
    // encapContentInfo: SEQUENCE { contentType, [0] EXPLICIT { OCTET STRING(TSTInfo) } }

    // Find all GeneralizedTime nodes - genTime is typically the first one in TSTInfo
    const genTimeNodes = findAllByTag(root, TAG_GENERALIZED_TIME);
    const genTime = genTimeNodes.length > 0
      ? decodeGeneralizedTime(genTimeNodes[0].value)
      : "unknown";

    // Find the TSTInfo by looking for the inner content
    // TSTInfo contains: version, policy OID, messageImprint, serialNumber, genTime
    // We look for OCTET STRING nodes that contain a SEQUENCE (TSTInfo)
    let serialNumber = "unknown";
    let hashedMessage = "";
    let hashAlgorithm = "SHA-256";

    const octetStrings = findAllByTag(root, TAG_OCTET_STRING);
    for (const os of octetStrings) {
      // Try to parse as TSTInfo
      try {
        if (os.value.byteLength < 20) continue;
        const inner = parseDer(os.value);
        if (inner.tag === TAG_SEQUENCE && inner.children && inner.children.length >= 5) {
          // Likely TSTInfo: version, policy, messageImprint, serialNumber, genTime
          const versionNode = inner.children[0];
          if (versionNode.tag === TAG_INTEGER && versionNode.value[0] === 1) {
            // This is TSTInfo
            // serialNumber is child[3]
            const serialNode = inner.children[3];
            if (serialNode.tag === TAG_INTEGER) {
              serialNumber = Array.from(serialNode.value)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
            }
            // messageImprint is child[2]
            const miNode = inner.children[2];
            if (miNode.children && miNode.children.length >= 2) {
              const hashNode = miNode.children[1];
              if (hashNode.tag === TAG_OCTET_STRING) {
                hashedMessage = Array.from(hashNode.value)
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
              }
            }
          }
        }
      } catch {
        // Not a valid TSTInfo, skip
      }
    }

    return {
      genTime,
      serialNumber,
      tsaName: null,
      hashAlgorithm,
      hashedMessage,
      raw: base64Token,
    };
  } catch {
    return null;
  }
}

// --- Main API ---

/**
 * Request a trusted timestamp from a TSA for the given SHA-256 hash.
 * Returns the base64-encoded timestamp token, or null on failure.
 */
export async function requestTimestamp(evidenceHashHex: string): Promise<string | null> {
  const reqBytes = buildTimeStampReq(evidenceHashHex);

  for (const endpoint of TSA_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/timestamp-query",
        },
        body: reqBytes,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const respBytes = new Uint8Array(await response.arrayBuffer());
      const parsed = parseTimeStampResp(respBytes);

      if (parsed.status > 1) {
        console.warn(`[Witness] TSA ${endpoint} rejected request: status=${parsed.status} ${parsed.statusString ?? ""}`);
        continue;
      }

      if (!parsed.token || parsed.token.byteLength === 0) {
        console.warn(`[Witness] TSA ${endpoint} returned empty token`);
        continue;
      }

      console.log(`[Witness] Got RFC 3161 timestamp from ${endpoint}`);
      return bytesToBase64(parsed.token);
    } catch (err) {
      console.warn(`[Witness] TSA ${endpoint} failed:`, err);
      continue;
    }
  }

  console.warn("[Witness] All TSA endpoints failed, no trusted timestamp");
  return null;
}

/**
 * Verify that a stored timestamp token matches the expected evidence hash.
 * Returns parsed timestamp info, or null if token is invalid.
 */
export function verifyTimestamp(base64Token: string, expectedHashHex: string): TimestampInfo | null {
  const info = parseTimestampToken(base64Token);
  if (!info) return null;

  // Check that the hash in the token matches
  if (info.hashedMessage && info.hashedMessage !== expectedHashHex) {
    console.warn("[Witness] Timestamp hash mismatch:", info.hashedMessage, "!=", expectedHashHex);
    return null;
  }

  return info;
}

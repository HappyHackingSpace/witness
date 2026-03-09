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
  value: Uint8Array<ArrayBuffer>;
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

  const value = data.subarray(offset, offset + length) as Uint8Array<ArrayBuffer>;
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
    const hashAlgorithm = "SHA-256";

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
        body: reqBytes as BodyInit,
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

// --- Known algorithm OIDs ---

// RSA: 1.2.840.113549.1.1.1
const OID_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
// EC: 1.2.840.10045.2.1
const OID_EC = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
// P-384: 1.3.132.0.34
const OID_P384 = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x22]);
// P-521: 1.3.132.0.35
const OID_P521 = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x23]);

// RSA signature OIDs
// sha256WithRSAEncryption: 1.2.840.113549.1.1.11
const OID_RSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
// sha384WithRSAEncryption: 1.2.840.113549.1.1.12
const OID_RSA_SHA384 = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0c]);
// sha512WithRSAEncryption: 1.2.840.113549.1.1.13
const OID_RSA_SHA512 = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d]);
// ecdsaWithSHA256: 1.2.840.10045.4.3.2
const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
// ecdsaWithSHA384: 1.2.840.10045.4.3.3
const OID_ECDSA_SHA384 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03]);
// ecdsaWithSHA512: 1.2.840.10045.4.3.4
const OID_ECDSA_SHA512 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x04]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Re-encode a DER node from its raw source bytes (tag + length + value)
function reencodeNode(sourceData: Uint8Array, node: DerNode): Uint8Array<ArrayBuffer> {
  const start = node.offset - (node.totalLength - node.value.byteLength);
  return sourceData.subarray(start, start + node.totalLength) as Uint8Array<ArrayBuffer>;
}

// Extract CMS SignedData components needed for signature verification
function extractCmsSignedData(tokenData: Uint8Array): {
  signedAttrsBytes: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
  spkiBytes: Uint8Array<ArrayBuffer>;
  signatureAlgOid: Uint8Array<ArrayBuffer>;
  digestAlgOid: Uint8Array<ArrayBuffer>;
  spkiAlgOid: Uint8Array<ArrayBuffer>;
  spkiCurveOid: Uint8Array<ArrayBuffer> | null;
} | null {
  try {
    const root = parseDer(tokenData);
    // ContentInfo: SEQUENCE { OID(signedData), [0] EXPLICIT { SignedData } }
    if (!root.children || root.children.length < 2) return null;

    // [0] EXPLICIT wrapping SignedData
    const contentWrapper = root.children[1];
    if ((contentWrapper.tag & 0x1f) !== 0 || !contentWrapper.children?.length) return null;

    const signedData = contentWrapper.children[0];
    if (!signedData.children || signedData.children.length < 4) return null;

    // SignedData children: version, digestAlgorithms, encapContentInfo, [certificates], [crls], signerInfos
    // Find certificates (tag 0xa0) and signerInfos (tag 0x31 SET)
    let certificates: DerNode | null = null;
    let signerInfos: DerNode | null = null;
    let digestAlgorithms: DerNode | null = null;

    for (const child of signedData.children) {
      if (child.tag === 0xa0) certificates = child; // implicit [0] certificates
      if (child.tag === 0x31 && !digestAlgorithms) {
        // First SET is digestAlgorithms, last SET is signerInfos
        digestAlgorithms = child;
      }
    }
    // signerInfos is the last SET in SignedData
    for (let i = signedData.children.length - 1; i >= 0; i--) {
      if (signedData.children[i].tag === 0x31) {
        signerInfos = signedData.children[i];
        break;
      }
    }

    if (!certificates?.children?.length || !signerInfos?.children?.length) return null;

    // Extract first certificate's SubjectPublicKeyInfo
    const cert = certificates.children[0];
    if (!cert.children || cert.children.length < 1) return null;
    const tbsCert = cert.children[0]; // tbsCertificate
    if (!tbsCert.children || tbsCert.children.length < 7) return null;

    // SubjectPublicKeyInfo is at index 6 in tbsCertificate
    // (version[0], serialNumber, signature, issuer, validity, subject, SPKI)
    const spki = tbsCert.children[6];
    if (spki.tag !== TAG_SEQUENCE) return null;
    const spkiBytes = reencodeNode(certificates.children[0].value, spki);

    // Get SPKI algorithm OID
    let spkiAlgOid = new Uint8Array(0);
    let spkiCurveOid: Uint8Array<ArrayBuffer> | null = null;
    if (spki.children && spki.children.length >= 1) {
      const algIdNode = spki.children[0];
      if (algIdNode.children && algIdNode.children.length >= 1) {
        spkiAlgOid = algIdNode.children[0].value;
        if (algIdNode.children.length >= 2 && algIdNode.children[1].tag === TAG_OID) {
          spkiCurveOid = algIdNode.children[1].value;
        }
      }
    }

    // Extract first SignerInfo
    const signerInfo = signerInfos.children[0];
    if (!signerInfo.children || signerInfo.children.length < 5) return null;

    // SignerInfo: version, sid, digestAlgorithm, [0]signedAttrs, signatureAlgorithm, signature
    let signedAttrsNode: DerNode | null = null;
    let sigAlgNode: DerNode | null = null;
    let sigNode: DerNode | null = null;
    let digestAlgNode: DerNode | null = null;

    for (let i = 0; i < signerInfo.children.length; i++) {
      const child = signerInfo.children[i];
      if (child.tag === 0xa0) signedAttrsNode = child; // implicit [0] signedAttrs
      if (child.tag === TAG_OCTET_STRING && !sigNode && signedAttrsNode) sigNode = child;
    }

    // digestAlgorithm is child[2] (SEQUENCE), signatureAlgorithm comes after signedAttrs
    digestAlgNode = signerInfo.children[2];
    // Find signatureAlgorithm: the SEQUENCE after signedAttrs
    for (let i = 0; i < signerInfo.children.length; i++) {
      if (signerInfo.children[i] === signedAttrsNode && i + 1 < signerInfo.children.length) {
        sigAlgNode = signerInfo.children[i + 1];
        if (i + 2 < signerInfo.children.length) {
          sigNode = signerInfo.children[i + 2];
        }
        break;
      }
    }

    if (!signedAttrsNode || !sigAlgNode || !sigNode) return null;

    // Replace implicit [0] tag (0xa0) with SET (0x31) for verification
    const signedAttrsRaw = reencodeNode(signerInfo.value, signedAttrsNode);
    const signedAttrsBytes = new Uint8Array(signedAttrsRaw);
    signedAttrsBytes[0] = 0x31; // SET OF

    // Extract signature bytes (OCTET STRING value)
    const signature = sigNode.value;

    // Extract signature algorithm OID
    const signatureAlgOid = sigAlgNode.children?.[0]?.value ?? new Uint8Array(0);

    // Extract digest algorithm OID
    const digestAlgOid = digestAlgNode?.children?.[0]?.value ?? SHA256_OID;

    return {
      signedAttrsBytes,
      signature,
      spkiBytes,
      signatureAlgOid,
      digestAlgOid,
      spkiAlgOid,
      spkiCurveOid,
    };
  } catch {
    return null;
  }
}

// Convert ECDSA DER signature (SEQUENCE { INTEGER r, INTEGER s }) to IEEE P1363 (r||s)
function ecdsaDerToP1363(derSig: Uint8Array<ArrayBuffer>, curveByteLen: number): Uint8Array<ArrayBuffer> {
  try {
    const seq = parseDer(derSig);
    if (!seq.children || seq.children.length < 2) return derSig;
    const rRaw = seq.children[0].value;
    const sRaw = seq.children[1].value;

    // Strip leading zero bytes used for sign padding
    const stripLeadingZeros = (b: Uint8Array) => {
      let i = 0;
      while (i < b.length - 1 && b[i] === 0) i++;
      return b.subarray(i);
    };

    const r = stripLeadingZeros(rRaw);
    const s = stripLeadingZeros(sRaw);

    // Left-pad to curve byte length
    const result = new Uint8Array(curveByteLen * 2);
    result.set(r, curveByteLen - r.length);
    result.set(s, curveByteLen * 2 - s.length);
    return result;
  } catch {
    return derSig;
  }
}

// Determine algorithm parameters for Web Crypto from OIDs
function resolveAlgorithm(
  signatureAlgOid: Uint8Array,
  spkiAlgOid: Uint8Array,
  spkiCurveOid: Uint8Array | null,
): {
  importAlg: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  verifyAlg: AlgorithmIdentifier | EcdsaParams;
  isEcdsa: boolean;
  curveByteLen: number;
} | null {
  // Check RSA signature OIDs
  if (bytesEqual(signatureAlgOid, OID_RSA_SHA256) || (bytesEqual(spkiAlgOid, OID_RSA) && bytesEqual(signatureAlgOid, OID_RSA_SHA256))) {
    return {
      importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verifyAlg: "RSASSA-PKCS1-v1_5",
      isEcdsa: false,
      curveByteLen: 0,
    };
  }
  if (bytesEqual(signatureAlgOid, OID_RSA_SHA384)) {
    return {
      importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
      verifyAlg: "RSASSA-PKCS1-v1_5",
      isEcdsa: false,
      curveByteLen: 0,
    };
  }
  if (bytesEqual(signatureAlgOid, OID_RSA_SHA512)) {
    return {
      importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
      verifyAlg: "RSASSA-PKCS1-v1_5",
      isEcdsa: false,
      curveByteLen: 0,
    };
  }

  // Check ECDSA signature OIDs
  if (bytesEqual(signatureAlgOid, OID_ECDSA_SHA256)) {
    const curve = spkiCurveOid && bytesEqual(spkiCurveOid, OID_P384) ? "P-384" : "P-256";
    return {
      importAlg: { name: "ECDSA", namedCurve: curve },
      verifyAlg: { name: "ECDSA", hash: "SHA-256" },
      isEcdsa: true,
      curveByteLen: curve === "P-384" ? 48 : 32,
    };
  }
  if (bytesEqual(signatureAlgOid, OID_ECDSA_SHA384)) {
    const curve = spkiCurveOid && bytesEqual(spkiCurveOid, OID_P521) ? "P-521" : "P-384";
    return {
      importAlg: { name: "ECDSA", namedCurve: curve },
      verifyAlg: { name: "ECDSA", hash: "SHA-384" },
      isEcdsa: true,
      curveByteLen: curve === "P-521" ? 66 : 48,
    };
  }
  if (bytesEqual(signatureAlgOid, OID_ECDSA_SHA512)) {
    return {
      importAlg: { name: "ECDSA", namedCurve: "P-521" },
      verifyAlg: { name: "ECDSA", hash: "SHA-512" },
      isEcdsa: true,
      curveByteLen: 66,
    };
  }

  // Fallback: detect from SPKI algorithm
  if (bytesEqual(spkiAlgOid, OID_RSA)) {
    return {
      importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verifyAlg: "RSASSA-PKCS1-v1_5",
      isEcdsa: false,
      curveByteLen: 0,
    };
  }
  if (bytesEqual(spkiAlgOid, OID_EC)) {
    let curve = "P-256";
    let byteLen = 32;
    let hash = "SHA-256";
    if (spkiCurveOid) {
      if (bytesEqual(spkiCurveOid, OID_P384)) { curve = "P-384"; byteLen = 48; hash = "SHA-384"; }
      else if (bytesEqual(spkiCurveOid, OID_P521)) { curve = "P-521"; byteLen = 66; hash = "SHA-512"; }
    }
    return {
      importAlg: { name: "ECDSA", namedCurve: curve },
      verifyAlg: { name: "ECDSA", hash },
      isEcdsa: true,
      curveByteLen: byteLen,
    };
  }

  return null;
}

/**
 * Verify the cryptographic signature of an RFC 3161 timestamp token.
 *
 * Verification steps:
 * 1. Parse CMS SignedData and extract signer certificate, signed attributes, and signature
 * 2. Import the TSA's public key from its X.509 certificate (SPKI format)
 * 3. Verify the signature over the signed attributes using Web Crypto API
 * 4. Check that the embedded hash matches the expected evidence hash
 * 5. Validate the genTime format
 *
 * NOTE: Certificate chain validation (is the TSA cert trusted by a CA?) is not
 * possible with Web Crypto API alone. For court-grade chain verification, use
 * `openssl ts -verify` against the exported token.
 */
export async function verifyTimestamp(base64Token: string, expectedHashHex: string): Promise<TimestampInfo | null> {
  const info = parseTimestampToken(base64Token);
  if (!info) return null;

  // The token must contain a hash and it must match the expected evidence hash
  if (!info.hashedMessage) {
    console.warn("[Witness] Timestamp token contains no hashed message");
    return null;
  }

  if (info.hashedMessage !== expectedHashHex) {
    console.warn("[Witness] Timestamp hash mismatch:", info.hashedMessage, "!=", expectedHashHex);
    return null;
  }

  // Validate genTime is a plausible ISO timestamp
  if (info.genTime === "unknown" || !info.genTime.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
    console.warn("[Witness] Timestamp has invalid genTime:", info.genTime);
    return null;
  }

  // Cryptographic signature verification
  try {
    const tokenData = base64ToBytes(base64Token);
    const cms = extractCmsSignedData(tokenData);
    if (!cms) {
      console.warn("[Witness] Could not extract CMS SignedData for signature verification");
      return null;
    }

    const alg = resolveAlgorithm(cms.signatureAlgOid, cms.spkiAlgOid, cms.spkiCurveOid);
    if (!alg) {
      console.warn("[Witness] Unsupported signature algorithm in timestamp token");
      return null;
    }

    // Import the TSA's public key from the certificate's SPKI
    const publicKey = await crypto.subtle.importKey(
      "spki",
      cms.spkiBytes,
      alg.importAlg,
      false,
      ["verify"],
    );

    // Convert ECDSA signature from DER to P1363 format if needed
    let sigBytes = cms.signature;
    if (alg.isEcdsa) {
      sigBytes = ecdsaDerToP1363(sigBytes, alg.curveByteLen);
    }

    // Verify the signature over the signed attributes
    const valid = await crypto.subtle.verify(
      alg.verifyAlg,
      publicKey,
      sigBytes,
      cms.signedAttrsBytes,
    );

    if (!valid) {
      console.warn("[Witness] Timestamp signature verification FAILED");
      return null;
    }

    console.log("[Witness] Timestamp signature verified successfully");
  } catch (err) {
    console.warn("[Witness] Timestamp signature verification error:", err);
    return null;
  }

  return info;
}

// Minimal CFB (OLE2) reader + ECMA-376 Agile decrypt for password-protected XLSX.
// Adapted for Capito's no-build browser import path (Web Crypto only).

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MINI_CUTOFF = 4096;

const BLOCK_VERIFIER_INPUT = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const BLOCK_VERIFIER_VALUE = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const BLOCK_KEY_VALUE = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
const SEGMENT = 4096;
const ZERO_IV = new Uint8Array(16);

function concat(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function utf16le(text) {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) view.setUint16(i * 2, text.charCodeAt(i), true);
  return out;
}

function base64Decode(value = "") {
  const binary = atob(String(value || ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function getElementTag(xml, local) {
  const match = new RegExp(`<(?:\\w+:)?${local}\\b[^>]*?/?>`).exec(xml);
  return match ? match[0] : null;
}

function getAttr(tag, name) {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] || "";
}

function mapHashAlgorithm(name = "") {
  const normalized = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized === "SHA512") return "SHA-512";
  if (normalized === "SHA384") return "SHA-384";
  if (normalized === "SHA256") return "SHA-256";
  if (normalized === "SHA1") return "SHA-1";
  return "SHA-1";
}

function fitKey(hashBytes, keyBytes) {
  if (hashBytes.length >= keyBytes) return hashBytes.subarray(0, keyBytes);
  const out = new Uint8Array(keyBytes).fill(0x36);
  out.set(hashBytes, 0);
  return out;
}

function fitIv(hashBytes, blockSize) {
  return fitKey(hashBytes, blockSize);
}

function asBufferSource(bytes) {
  return bytes;
}

async function digest(algo, data) {
  return new Uint8Array(await crypto.subtle.digest(algo, asBufferSource(data)));
}

async function importAesKey(raw) {
  return crypto.subtle.importKey("raw", asBufferSource(raw), { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
}

async function ecbBlock(key, block) {
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: asBufferSource(ZERO_IV) }, key, asBufferSource(block)));
  return out.subarray(0, 16);
}

async function aesDecryptRaw(key, ivBytes, data) {
  if (!data.length) return new Uint8Array(0);
  const last = data.subarray(data.length - 16);
  const x = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) x[i] = last[i] ^ 0x10;
  const pad = await ecbBlock(key, x);
  const ext = concat([data, pad]);
  const dec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: asBufferSource(ivBytes) }, key, asBufferSource(ext)));
  return dec.subarray(0, data.length);
}

async function aesDecrypt(rawKey, ivBytes, data) {
  return aesDecryptRaw(await importAesKey(rawKey), ivBytes, data);
}

export function readCfbStreams(data) {
  if (data.length < 512) throw new Error("CFB: file too small");
  for (let i = 0; i < CFB_SIG.length; i += 1) {
    if (data[i] !== CFB_SIG[i]) throw new Error("CFB: bad signature");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sectorShift = view.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorShift = view.getUint16(32, true);
  const miniSectorSize = 1 << miniSectorShift;
  const numFatSectors = view.getUint32(44, true);
  const firstDirSector = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true) || MINI_CUTOFF;
  const firstMiniFatSector = view.getUint32(60, true);
  const numMiniFatSectors = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const numDifatSectors = view.getUint32(72, true);

  const sectorOffset = sector => (sector + 1) * sectorSize;
  const readSector = sector => {
    const off = sectorOffset(sector);
    if (off + sectorSize > data.length) throw new Error("CFB: sector out of range");
    return data.subarray(off, off + sectorSize);
  };

  const fatSectorList = [];
  for (let i = 0; i < 109 && fatSectorList.length < numFatSectors; i += 1) {
    const sector = view.getUint32(76 + i * 4, true);
    if (sector === FREESECT || sector === ENDOFCHAIN) break;
    fatSectorList.push(sector);
  }
  const maxSectors = Math.floor(data.length / sectorSize) + 1;
  const difatLimit = Math.min(numDifatSectors, maxSectors);
  let difatSector = firstDifatSector;
  let difatGuard = 0;
  while (difatSector !== ENDOFCHAIN && difatSector !== FREESECT && difatLimit > 0 && difatGuard++ < difatLimit + 1) {
    const sec = readSector(difatSector);
    const dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    const entries = sectorSize / 4 - 1;
    for (let i = 0; i < entries && fatSectorList.length < numFatSectors; i += 1) {
      const sector = dv.getUint32(i * 4, true);
      if (sector !== FREESECT && sector !== ENDOFCHAIN) fatSectorList.push(sector);
    }
    difatSector = dv.getUint32(sectorSize - 4, true);
  }

  const fat = [];
  for (const fatSector of fatSectorList) {
    const sec = readSector(fatSector);
    const dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(dv.getUint32(i * 4, true));
  }

  const chain = start => {
    const out = [];
    let sector = start;
    let guard = 0;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && guard++ < fat.length + 1) {
      out.push(sector);
      sector = fat[sector] ?? ENDOFCHAIN;
    }
    return out;
  };

  const readChain = (start, size) => {
    const sectors = chain(start);
    const buf = new Uint8Array(sectors.length * sectorSize);
    let offset = 0;
    for (const sector of sectors) {
      buf.set(readSector(sector), offset);
      offset += sectorSize;
    }
    return size >= 0 ? buf.subarray(0, size) : buf;
  };

  const dirBytes = readChain(firstDirSector, -1);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const type = dirBytes[off + 66];
    if (type === 0) continue;
    const nameLen = dirView.getUint16(off + 64, true);
    let name = "";
    for (let i = 0; i + 1 < nameLen; i += 2) {
      const code = dirView.getUint16(off + i, true);
      if (code === 0) break;
      name += String.fromCharCode(code);
    }
    entries.push({
      name,
      type,
      startSector: dirView.getUint32(off + 116, true),
      size: dirView.getUint32(off + 120, true)
    });
  }

  const root = entries.find(entry => entry.type === 5);
  if (!root) throw new Error("CFB: missing root entry");
  const miniStream = readChain(root.startSector, root.size);
  const miniFat = [];
  if (numMiniFatSectors > 0 && firstMiniFatSector !== ENDOFCHAIN) {
    const mfBytes = readChain(firstMiniFatSector, numMiniFatSectors * sectorSize);
    const mfView = new DataView(mfBytes.buffer, mfBytes.byteOffset, mfBytes.byteLength);
    for (let i = 0; i < mfBytes.length / 4; i += 1) miniFat.push(mfView.getUint32(i * 4, true));
  }

  const readMini = (start, size) => {
    if (size < 0 || size > miniStream.length) throw new Error("CFB: mini stream size out of range");
    const out = new Uint8Array(size);
    let sector = start;
    let offset = 0;
    let guard = 0;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && offset < size && guard++ < miniFat.length + 1) {
      const from = sector * miniSectorSize;
      const take = Math.min(miniSectorSize, size - offset);
      out.set(miniStream.subarray(from, from + take), offset);
      offset += take;
      sector = miniFat[sector] ?? ENDOFCHAIN;
    }
    return out;
  };

  const streams = new Map();
  for (const entry of entries) {
    if (entry.type !== 2) continue;
    streams.set(
      entry.name,
      entry.size < miniCutoff ? readMini(entry.startSector, entry.size) : readChain(entry.startSector, entry.size)
    );
  }
  return streams;
}

async function passwordChain(password, salt, spinCount, algo) {
  let hash = await digest(algo, concat([salt, utf16le(password)]));
  const counter = new Uint8Array(4);
  const counterView = new DataView(counter.buffer);
  for (let i = 0; i < spinCount; i += 1) {
    counterView.setUint32(0, i, true);
    hash = await digest(algo, concat([counter, hash]));
  }
  return hash;
}

async function deriveBlockKey(chainHash, blockKey, keyBytes, algo) {
  return fitKey(await digest(algo, concat([chainHash, blockKey])), keyBytes);
}

function parseKeyEncryptor(xml) {
  const tag = getElementTag(xml, "encryptedKey");
  if (!tag) throw new Error("EncryptionInfo is missing password key encryptor.");
  return {
    saltValue: base64Decode(getAttr(tag, "saltValue")),
    hashAlgorithm: mapHashAlgorithm(getAttr(tag, "hashAlgorithm")),
    keyBytes: Math.max(16, Number(getAttr(tag, "keyBits") || 128) / 8),
    blockSize: Number(getAttr(tag, "blockSize") || 16),
    spinCount: Number(getAttr(tag, "spinCount") || 100000),
    encryptedVerifierHashInput: base64Decode(getAttr(tag, "encryptedVerifierHashInput")),
    encryptedVerifierHashValue: base64Decode(getAttr(tag, "encryptedVerifierHashValue")),
    encryptedKeyValue: base64Decode(getAttr(tag, "encryptedKeyValue"))
  };
}

function parseKeyData(xml) {
  const tag = getElementTag(xml, "keyData");
  if (!tag) throw new Error("EncryptionInfo is missing keyData.");
  return {
    saltValue: base64Decode(getAttr(tag, "saltValue")),
    hashAlgorithm: mapHashAlgorithm(getAttr(tag, "hashAlgorithm")),
    keyBytes: Math.max(16, Number(getAttr(tag, "keyBits") || 128) / 8),
    blockSize: Number(getAttr(tag, "blockSize") || 16)
  };
}

async function deriveSecretKey(password, key) {
  const chainHash = await passwordChain(password, key.saltValue, key.spinCount, key.hashAlgorithm);
  const kVin = await deriveBlockKey(chainHash, BLOCK_VERIFIER_INPUT, key.keyBytes, key.hashAlgorithm);
  const kVval = await deriveBlockKey(chainHash, BLOCK_VERIFIER_VALUE, key.keyBytes, key.hashAlgorithm);
  const kVkey = await deriveBlockKey(chainHash, BLOCK_KEY_VALUE, key.keyBytes, key.hashAlgorithm);
  const verifierInput = await aesDecrypt(kVin, key.saltValue, key.encryptedVerifierHashInput);
  const expectedHash = await aesDecrypt(kVval, key.saltValue, key.encryptedVerifierHashValue);
  const actualHash = await digest(key.hashAlgorithm, verifierInput);
  const hashLen = Math.min(actualHash.length, expectedHash.length);
  if (!bytesEqual(actualHash.subarray(0, hashLen), expectedHash.subarray(0, hashLen))) return null;
  const secret = await aesDecrypt(kVkey, key.saltValue, key.encryptedKeyValue);
  return secret.subarray(0, key.keyBytes);
}

async function decryptPackage(pkg, secretKey, keyData) {
  const totalSize = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true));
  const cipher = pkg.subarray(8);
  const out = new Uint8Array(Math.ceil(cipher.length / SEGMENT) * SEGMENT);
  const counter = new Uint8Array(4);
  const counterView = new DataView(counter.buffer);
  let offset = 0;
  let segIndex = 0;
  while (offset < cipher.length) {
    const chunk = cipher.subarray(offset, Math.min(offset + SEGMENT, cipher.length));
    counterView.setUint32(0, segIndex, true);
    const segIv = fitIv(await digest(keyData.hashAlgorithm, concat([keyData.saltValue, counter])), keyData.blockSize);
    const plain = await aesDecrypt(secretKey, segIv, chunk);
    out.set(plain, offset);
    offset += SEGMENT;
    segIndex += 1;
  }
  return out.subarray(0, totalSize);
}

export async function decryptAgileXlsx(bytes, password) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const streams = readCfbStreams(bytes);
  const info = streams.get("EncryptionInfo");
  const pkg = streams.get("EncryptedPackage");
  if (!info || !pkg) throw new Error("Encrypted workbook is missing EncryptionInfo/EncryptedPackage.");
  const major = info[0] | (info[1] << 8);
  const minor = info[2] | (info[3] << 8);
  if (major !== 4 || minor !== 4) {
    throw new Error(`Unsupported Office encryption version ${major}.${minor}. Only Agile encryption is supported.`);
  }
  const xml = new TextDecoder("utf-8").decode(info.subarray(8));
  const key = parseKeyEncryptor(xml);
  const keyData = parseKeyData(xml);
  const secretKey = await deriveSecretKey(password, key);
  if (!secretKey) throw new Error("Incorrect spreadsheet password.");
  return decryptPackage(pkg, secretKey, keyData);
}

export function isOleCompoundFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return false;
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

// Minimal ZIP file writer -- STORE method only (no compression). Written by
// hand against the plain ZIP local/central-directory/EOCD format because
// this app's CSP is script-src 'self' with no CDN allowlist for a real
// compression library, and STORE is a fully valid, universally-readable
// ZIP entry type (just uncompressed) -- no external dependency needed for
// what's ultimately a batch of already-compressed PNGs anyway, where
// DEFLATE would buy little.

// Standard CRC-32 (polynomial 0xEDB88320), table-based -- the ZIP format's
// own required checksum per entry, computed once per file's raw bytes.
const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16le(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
function u32le(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]); }

// Builds a downloadable ZIP Blob from `files` = [{ name, data: Uint8Array }].
// Fixed DOS date/time (2020-01-01, arbitrary) -- these generated maps have
// no meaningful "last modified" moment worth encoding, and every real zip
// tool accepts any valid DOS date without complaint.
function createZipBlob(files) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;

    const local = [
      u32le(0x04034B50), u16le(20), u16le(0), u16le(0), u16le(DOS_TIME), u16le(DOS_DATE),
      u32le(crc), u32le(size), u32le(size), u16le(nameBytes.length), u16le(0), nameBytes, data,
    ];
    let localLen = 0;
    for (const p of local) { localParts.push(p); localLen += p.length; }

    const central = [
      u32le(0x02014B50), u16le(20), u16le(20), u16le(0), u16le(0), u16le(DOS_TIME), u16le(DOS_DATE),
      u32le(crc), u32le(size), u32le(size), u16le(nameBytes.length), u16le(0), u16le(0),
      u16le(0), u16le(0), u32le(0), u32le(offset), nameBytes,
    ];
    for (const p of central) { centralParts.push(p); centralSize += p.length; }

    offset += localLen;
  }

  const eocd = [
    u32le(0x06054B50), u16le(0), u16le(0), u16le(files.length), u16le(files.length),
    u32le(centralSize), u32le(offset), u16le(0),
  ];

  return new Blob([...localParts, ...centralParts, ...eocd], { type: 'application/zip' });
}

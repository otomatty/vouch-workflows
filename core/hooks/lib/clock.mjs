/** @returns {string} UTC timestamp; callers inject this function through HookContext. */
export function now() {
  return new Date().toISOString();
}

/** @param {string} session @param {string} identity @returns {string} Stable replay identity. */
export function newId(session, identity) {
  return `evt_${sha256Hex(Buffer.from(JSON.stringify([session, identity])))}`;
}

// FIPS 180-4 section 4.2.2: the SHA-256 round constants.
const rounds = Uint32Array.of(
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
);

/** @param {Uint32Array} words @param {number} index */
const at = (words, index) => /** @type {number} */ (words[index]);

/** @param {number} word @param {number} bits */
const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));

/** FIPS 180-4 section 6.2.2 step 1: message schedule word t from the earlier words.
 * @param {Uint32Array} schedule @param {number} t */
function expand(schedule, t) {
  const early = at(schedule, t - 15);
  const late = at(schedule, t - 2);
  return (
    (rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10)) +
    at(schedule, t - 7) +
    (rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3)) +
    at(schedule, t - 16)
  );
}

/**
 * SHA-256 (FIPS 180-4) as lowercase hex, equal to node:crypto's digest. It fingerprints
 * public audit data only, never secrets or signatures, so it need not run in constant time.
 * Computed here because node:crypto loads crypto and the stream modules into every record.
 * @param {Uint8Array} bytes @returns {string}
 */
export function sha256Hex(bytes) {
  // Padding: 0x80, zeros, then the bit length as a big-endian 64-bit integer.
  const message = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setBigUint64(message.length - 8, BigInt(bytes.length) * 8n);
  const hash = Uint32Array.of(
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  );
  const schedule = new Uint32Array(64);
  for (let block = 0; block < message.length; block += 64) {
    let a = at(hash, 0);
    let b = at(hash, 1);
    let c = at(hash, 2);
    let d = at(hash, 3);
    let e = at(hash, 4);
    let f = at(hash, 5);
    let g = at(hash, 6);
    let h = at(hash, 7);
    for (let t = 0; t < 64; t++) {
      schedule[t] =
        t < 16 ? view.getUint32(block + t * 4) : expand(schedule, t);
      const first =
        h +
        (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
        ((e & f) ^ (~e & g)) +
        at(rounds, t) +
        at(schedule, t);
      const second =
        (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
        ((a & b) ^ (a & c) ^ (b & c));
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    hash.set(
      [a, b, c, d, e, f, g, h].map((word, index) => word + at(hash, index)),
    );
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join(
    "",
  );
}

/** @param {string} value @returns {number|null} */
function utcMilliseconds(value) {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z(?![\s\S])/.exec(
      value,
    );
  if (!match) return null;
  const instant = new Date(value);
  const milliseconds = instant.getTime();
  if (
    Number.isNaN(milliseconds) ||
    instant.toISOString() !== `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`
  )
    return null;
  return milliseconds;
}

/** @type {import('./runtime-contracts.mjs').ElapsedMilliseconds} */
export function elapsedMilliseconds(start, end) {
  const first = utcMilliseconds(start);
  const last = utcMilliseconds(end);
  if (first === null || last === null) return null;
  const elapsed = last - first;
  return Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : null;
}

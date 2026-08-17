export function encodeVec(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    buf.writeFloatLE(values[i]!, i * 4);
  }
  return buf;
}

export function decodeVec(buf: Buffer | Uint8Array): number[] {
  const view = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const out: number[] = [];
  for (let i = 0; i + 4 <= view.length; i += 4) {
    out.push(view.readFloatLE(i));
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic unit-ish vector for tests and fallback keyword hashing. */
export function hashEmbed(text: string, dim = 32): number[] {
  const vec = new Array<number>(dim).fill(0);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const idx = (s.charCodeAt(i) + i * 13) % dim;
    vec[idx] = vec[idx]! + 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

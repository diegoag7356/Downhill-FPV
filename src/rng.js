// Semilla -> entero de 32 bits -> PRNG. Nada aquí usa Math.random ni Date.now.

/** FNV-1a de 32 bits. Devuelve un entero sin signo. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: PRNG determinista que devuelve [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GENERATOR_VERSION = 'v1';

/** Normaliza cualquier texto a un id de semilla público "v1:xxx". */
export function normalizeSeed(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const body = text.startsWith(`${GENERATOR_VERSION}:`)
    ? text.slice(GENERATOR_VERSION.length + 1)
    : text;
  const id = body.trim();
  if (!id) return null;
  return `${GENERATOR_VERSION}:${id}`;
}

/** Lee ?seed=v1:1234 de la URL (sin generar todavía ninguna pista). */
export function seedFromUrl(search = window.location.search) {
  const raw = new URLSearchParams(search).get('seed');
  return normalizeSeed(raw);
}

/** Semilla nueva sin tocar el PRNG global: entropía del sistema, no del generador. */
export function randomSeed() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return `${GENERATOR_VERSION}:${n[0] % 1000000}`;
}

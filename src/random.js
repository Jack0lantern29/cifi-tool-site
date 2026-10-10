/** Write settings in a consistent order so equivalent inputs match. */
export function canonicalStringify(value) {
  if (value instanceof Set) return canonicalStringify(Array.from(value).sort());
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Turn settings into a repeatable starting seed and run ID. */
export function deriveSeed(value) {
  const text = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Create a random sequence that repeats for the same seed. */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  // Return the next number in this run's random sequence.
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Turn the run's seed into a short readable ID.
export function formatRunId(seed) {
  return `RUN-${(seed >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

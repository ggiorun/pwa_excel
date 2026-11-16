// coordinates.js — conversione tra notazione A1 e indici numerici.
// Una cella è identificata da un id intero: id = riga * COLS + colonna (indici da 0).

export const COLS = 100; // A..CV
export const ROWS = 100; // 1..100

/** 0 -> "A", 25 -> "Z", 26 -> "AA", 99 -> "CV" */
export function colToLetters(c) {
  let s = '';
  c++;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

/** "A" -> 0, "AA" -> 26, "CV" -> 99 */
export function lettersToCol(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" o "$B$3" -> {c:1, r:2}; null se non è un riferimento sintatticamente valido. */
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return null;
  return { c: lettersToCol(m[1]), r: parseInt(m[2], 10) - 1 };
}

export const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
export const idOf = (c, r) => r * COLS + c;
export const colOf = (id) => id % COLS;
export const rowOf = (id) => Math.floor(id / COLS);
export const nameOf = (id) => colToLetters(colOf(id)) + (rowOf(id) + 1);

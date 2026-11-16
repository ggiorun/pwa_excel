/**
 * coordinates.js — conversione tra notazione A1 e indici numerici.
 *
 * Convenzioni: colonne e righe sono indicizzate da 0 (A1 = {col:0, row:0}).
 * Ogni cella ha anche una "chiave" numerica = riga * KEY_STRIDE + colonna,
 * molto più veloce da usare in Map/Set rispetto alla stringa "A1".
 */

export const MIN_ROWS = 100;   // dimensioni minime richieste dalla prova (A1:CV100)
export const MIN_COLS = 100;
export const MAX_ROWS = 1000;  // limiti massimi quando si inseriscono righe/colonne
export const MAX_COLS = 702;   // 702 = colonna "ZZ"
export const KEY_STRIDE = 1024; // > MAX_COLS: garantisce chiavi uniche

const labelCache = [];

/** 0 → "A", 25 → "Z", 26 → "AA", 99 → "CV" */
export function colToLabel(index) {
  if (labelCache[index]) return labelCache[index];
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return (labelCache[index] = s);
}

/** "A" → 0, "AA" → 26, "CV" → 99 */
export function labelToCol(label) {
  let n = 0;
  for (const ch of label.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" o "$B$3" → {col:1,row:2}; null se non è un riferimento valido. */
export function parseRef(text) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text);
  if (!m) return null;
  const row = parseInt(m[2], 10) - 1;
  if (row < 0) return null; // "A0" non esiste
  return { col: labelToCol(m[1]), row };
}

/** (1,2) → "B3" */
export const refToLabel = (col, row) => colToLabel(col) + (row + 1);

export const cellKey = (col, row) => row * KEY_STRIDE + col;
export const keyCol = (key) => key % KEY_STRIDE;
export const keyRow = (key) => Math.floor(key / KEY_STRIDE);

/**
 * app.js — interfaccia del foglio: griglia VIRTUALIZZATA, selezione, editing, barra della formula,
 * toolbar, salvataggio locale, esportazione CSV e registrazione del service worker.
 *
 * Strategia di virtualizzazione (in breve):
 *  • #sizer ha le dimensioni dell'intero foglio → le barre di scorrimento native funzionano e il
 *    browser fa lo scroll sul compositor (fluido, senza JavaScript per ogni pixel).
 *  • Nel DOM esistono solo le celle visibili + un piccolo margine (OVERSCAN). Ogni cella è un <div>
 *    con posizione assoluta FISSA (left/top calcolati una volta sola alla creazione).
 *  • A ogni scroll (coalescato con requestAnimationFrame) si aggiungono i <div> che entrano nella
 *    finestra e si rimuovono quelli che escono: il costo è proporzionale alle celle che cambiano,
 *    non alle 10.000 del foglio.
 *  • Intestazioni, evidenziazione di riga/colonna e cella selezionata sono overlay (transform), quindi
 *    non dipendono dalle celle presenti nel DOM.
 */
import { Sheet, SheetError, formatValue } from './engine.js';
import { colToLabel, parseRef, cellKey, keyCol, keyRow, refToLabel } from './coordinates.js';

const STORAGE_KEY = 'mini-sheet-pwa:v1';
const OVERSCAN = 3; // righe/colonne extra disegnate fuori dal viewport

const $ = (id) => document.getElementById(id);
const vp = $('viewport'), sizer = $('sizer'), colHdrs = $('colHdrInner'), rowHdrs = $('rowHdrs'), cellsEl = $('cells');
const selBox = $('selBox'), rowBand = $('rowBand'), colBand = $('colBand'), editor = $('editor');
const fb = $('formulaBar'), nameBox = $('nameBox');
const statusCell = $('statusCell'), statusPerf = $('statusPerf'), netBadge = $('netBadge');

const sheet = new Sheet();
let M = { colW: 96, rowH: 28, rhW: 52, chH: 28 };          // misure in px (lette dalle variabili CSS)
const sel = { col: 0, row: 0 };                             // cella selezionata
let editing = false;                                        // editor in-cella attivo
let fbDirty = false;                                        // barra della formula modificata e non ancora confermata
let touchLike = false;                                      // ultimo puntatore = tocco/penna (tap su cella selezionata = modifica)
let activeCol = -1, activeRow = -1;
const liveCells = new Map(), liveCols = new Map(), liveRows = new Map(); // elementi DOM attualmente presenti

/* ═══════════════════════ Misure e layout ═══════════════════════ */

function readMetrics() {
  const cs = getComputedStyle(document.documentElement);
  const n = (name, fallback) => parseFloat(cs.getPropertyValue(name)) || fallback;
  M = { colW: n('--col-w', 96), rowH: n('--row-h', 28), rhW: n('--rh-w', 52), chH: n('--ch-h', 28) };
}

/** Imposta le dimensioni dell'intero foglio e ridisegna da zero la parte visibile. */
function layout() {
  readMetrics();
  const W = sheet.cols * M.colW, H = sheet.rows * M.rowH;
  sizer.style.width = M.rhW + W + 'px';
  sizer.style.height = M.chH + H + 'px';
  rowHdrs.style.height = H + 'px';
  cellsEl.style.width = W + 'px';
  cellsEl.style.height = H + 'px';
  for (const m of [liveCells, liveCols, liveRows]) { for (const el of m.values()) el.remove(); m.clear(); }
  activeCol = activeRow = -1;
  renderVisible();
  updateSelectionUI();
}

/** Disegna solo ciò che è nel viewport (+ overscan) e rimuove il resto. */
function renderVisible() {
  const vw = vp.clientWidth - M.rhW, vh = vp.clientHeight - M.chH;
  const c0 = Math.max(0, Math.floor(vp.scrollLeft / M.colW) - OVERSCAN);
  const c1 = Math.min(sheet.cols - 1, Math.ceil((vp.scrollLeft + vw) / M.colW) + OVERSCAN);
  const r0 = Math.max(0, Math.floor(vp.scrollTop / M.rowH) - OVERSCAN);
  const r1 = Math.min(sheet.rows - 1, Math.ceil((vp.scrollTop + vh) / M.rowH) + OVERSCAN);

  // 1) rimuovi gli elementi usciti dalla finestra
  for (const [k, el] of liveCells) {
    const c = keyCol(k), r = keyRow(k);
    if (c < c0 || c > c1 || r < r0 || r > r1) { el.remove(); liveCells.delete(k); }
  }
  for (const [c, el] of liveCols) if (c < c0 || c > c1) { el.remove(); liveCols.delete(c); }
  for (const [r, el] of liveRows) if (r < r0 || r > r1) { el.remove(); liveRows.delete(r); }

  // 2) crea quelli entrati (un unico inserimento nel DOM tramite DocumentFragment)
  const frag = document.createDocumentFragment();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = cellKey(c, r);
      if (liveCells.has(k)) continue;
      const el = document.createElement('div');
      el.style.left = c * M.colW + 'px';
      el.style.top = r * M.rowH + 'px';
      paintCell(el, k);
      liveCells.set(k, el);
      frag.appendChild(el);
    }
  }
  cellsEl.appendChild(frag);

  const hc = document.createDocumentFragment();
  for (let c = c0; c <= c1; c++) {
    if (liveCols.has(c)) continue;
    const el = document.createElement('div');
    el.className = 'ch' + (c === sel.col ? ' active' : '');
    el.style.left = c * M.colW + 'px';
    el.textContent = colToLabel(c);
    liveCols.set(c, el); hc.appendChild(el);
  }
  colHdrs.appendChild(hc);
  const hr = document.createDocumentFragment();
  for (let r = r0; r <= r1; r++) {
    if (liveRows.has(r)) continue;
    const el = document.createElement('div');
    el.className = 'rh' + (r === sel.row ? ' active' : '');
    el.style.top = r * M.rowH + 'px';
    el.textContent = String(r + 1);
    liveRows.set(r, el); hr.appendChild(el);
  }
  rowHdrs.appendChild(hr);
}

let raf = 0;
function scheduleRender() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderVisible(); });
}

/** Aggiorna testo e stile di un <div> in base al contenuto della cella. */
function paintCell(el, key) {
  const c = sheet.cells.get(key);
  if (!c) { el.className = 'cell'; el.textContent = ''; el.removeAttribute('title'); return; }
  const v = c.value;
  let cls = 'cell';
  if (v instanceof SheetError) { cls += ' e'; el.title = v.msg; }
  else {
    el.removeAttribute('title');
    if (typeof v === 'number') cls += ' n'; else if (typeof v === 'boolean') cls += ' b';
  }
  el.className = cls;
  el.textContent = formatValue(v);
}

const repaint = (keys) => { for (const k of keys) { const el = liveCells.get(k); if (el) paintCell(el, k); } };
const refreshAll = () => { for (const [k, el] of liveCells) paintCell(el, k); };

/* ═══════════════════════ Selezione ═══════════════════════ */

const rawOf = (col, row) => sheet.rawOf(col, row);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function updateSelectionUI() {
  const x = sel.col * M.colW, y = sel.row * M.rowH;
  selBox.style.transform = `translate(${x}px, ${y}px)`;
  rowBand.style.transform = `translateY(${y}px)`;
  colBand.style.transform = `translateX(${x}px)`;
  liveCols.get(activeCol)?.classList.remove('active');
  liveRows.get(activeRow)?.classList.remove('active');
  activeCol = sel.col; activeRow = sel.row;
  liveCols.get(activeCol)?.classList.add('active');
  liveRows.get(activeRow)?.classList.add('active');
  nameBox.value = refToLabel(sel.col, sel.row);
  updateFormulaBar();
}

function updateFormulaBar() {
  fb.value = rawOf(sel.col, sel.row);
  fbDirty = false;
  updateStatus();
}

/** Riga di stato: indirizzo, tipo di contenuto e, se c'è un errore, la sua spiegazione. */
function updateStatus() {
  const c = sheet.cells.get(cellKey(sel.col, sel.row));
  const label = refToLabel(sel.col, sel.row);
  const isErr = c && c.value instanceof SheetError;
  statusCell.classList.toggle('has-error', !!isErr);
  statusCell.textContent = isErr
    ? `${label}: ${c.value.code}. ${c.value.msg}`
    : `${label}: ${!c ? 'vuota' : c.ast ? 'formula' : typeof c.value === 'number' ? 'numero' : 'testo'}`;
}

/** Porta la cella nel viewport se è (anche solo in parte) nascosta; tiene conto delle intestazioni sticky. */
function ensureVisible(col, row) {
  const vw = vp.clientWidth - M.rhW, vh = vp.clientHeight - M.chH;
  const x = col * M.colW, y = row * M.rowH;
  if (x < vp.scrollLeft) vp.scrollLeft = x;
  else if (x + M.colW > vp.scrollLeft + vw) vp.scrollLeft = x + M.colW - vw;
  if (y < vp.scrollTop) vp.scrollTop = y;
  else if (y + M.rowH > vp.scrollTop + vh) vp.scrollTop = y + M.rowH - vh;
  renderVisible(); // subito, senza aspettare l'evento scroll
}

function select(col, row, scroll = true) {
  col = clamp(col, 0, sheet.cols - 1);
  row = clamp(row, 0, sheet.rows - 1);
  commitPending();                       // conferma eventuali modifiche in corso sulla cella precedente
  sel.col = col; sel.row = row;
  if (scroll) ensureVisible(col, row);
  updateSelectionUI();
}
const move = (dc, dr) => select(sel.col + dc, sel.row + dr);
const pageRows = () => Math.max(1, Math.floor((vp.clientHeight - M.chH) / M.rowH) - 1);

/* ═══════════════════════ Modifica del contenuto ═══════════════════════ */

/** Applica il nuovo contenuto: ricalcola solo le celle dipendenti e ridisegna solo quelle cambiate. */
function commit(col, row, text) {
  if (text === rawOf(col, row)) return;
  const t0 = performance.now();
  const res = sheet.setCell(col, row, text);
  repaint(res.changed);
  const ms = performance.now() - t0;
  setMsg(res.evaluated
    ? `Ricalcolate ${res.evaluated} ${res.evaluated === 1 ? 'formula' : 'formule'} in ${ms.toFixed(1)} ms`
    : '');
  if (col === sel.col && row === sel.row) updateFormulaBar(); else updateStatus();
  saveSoon();
}
const setMsg = (t) => { statusPerf.textContent = t; };

function startEdit(initial) {
  if (editing) return;
  editing = true;
  editor.style.left = sel.col * M.colW + 'px';
  editor.style.top = sel.row * M.rowH + 'px';
  editor.style.width = Math.max(M.colW, 140) + 'px';
  editor.hidden = false;
  selBox.hidden = true;
  editor.value = initial ?? rawOf(sel.col, sel.row);
  fb.value = editor.value;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(editor.value.length, editor.value.length);
}
function stopEdit() { editing = false; editor.hidden = true; selBox.hidden = false; }

function finishEdit(dc, dr, refocus = true) {
  if (!editing) return;
  const text = editor.value;
  stopEdit();
  commit(sel.col, sel.row, text);
  if (dc || dr) select(sel.col + dc, sel.row + dr); else updateFormulaBar();
  if (refocus) vp.focus({ preventScroll: true });
}
function cancelEdit() { stopEdit(); updateFormulaBar(); vp.focus({ preventScroll: true }); }

/** Conferma ciò che l'utente sta scrivendo (editor in-cella o barra della formula) prima di cambiare cella. */
function commitPending() {
  if (editing) {
    const text = editor.value;
    stopEdit();
    commit(sel.col, sel.row, text);
  } else if (fbDirty) {
    fbDirty = false;
    commit(sel.col, sel.row, fb.value);
  }
}

editor.addEventListener('input', () => { fb.value = editor.value; });
editor.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter') { e.preventDefault(); finishEdit(0, e.shiftKey ? -1 : 1); }
  else if (e.key === 'Tab') { e.preventDefault(); finishEdit(e.shiftKey ? -1 : 1, 0); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
});
editor.addEventListener('blur', () => { if (editing) finishEdit(0, 0, false); });

fb.addEventListener('input', () => { fbDirty = true; });
fb.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    commitPending();
    if (e.key === 'Enter') move(0, e.shiftKey ? -1 : 1); else move(e.shiftKey ? -1 : 1, 0);
    vp.focus({ preventScroll: true });
  } else if (e.key === 'Escape') { updateFormulaBar(); vp.focus({ preventScroll: true }); }
});
fb.addEventListener('blur', () => { if (fbDirty) { fbDirty = false; commit(sel.col, sel.row, fb.value); } });

nameBox.addEventListener('focus', () => nameBox.select());
nameBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const p = parseRef(nameBox.value.trim());
  if (p && p.col < sheet.cols && p.row < sheet.rows) { select(p.col, p.row); vp.focus({ preventScroll: true }); }
  else { nameBox.classList.add('is-invalid'); setTimeout(() => nameBox.classList.remove('is-invalid'), 900); }
});

/* ═══════════════════════ Tastiera e puntatore sulla griglia ═══════════════════════ */

vp.addEventListener('scroll', scheduleRender, { passive: true });

vp.addEventListener('keydown', (e) => {
  if (e.target !== vp || e.isComposing) return;       // i tasti dell'editor/barra formula sono gestiti sopra
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case 'ArrowUp': move(0, -1); break;
    case 'ArrowDown': move(0, 1); break;
    case 'ArrowLeft': move(-1, 0); break;
    case 'ArrowRight': move(1, 0); break;
    case 'Tab': move(e.shiftKey ? -1 : 1, 0); break;
    case 'Enter': move(0, e.shiftKey ? -1 : 1); break;
    case 'PageDown': move(0, pageRows()); break;
    case 'PageUp': move(0, -pageRows()); break;
    case 'Home': if (ctrl) select(0, 0); else select(0, sel.row); break;
    case 'End': { if (ctrl) { const u = sheet.usedRange(); select(Math.max(0, u.cols - 1), Math.max(0, u.rows - 1)); } else select(sheet.cols - 1, sel.row); break; }
    case 'F2': startEdit(); break;
    case 'Delete': case 'Backspace': commit(sel.col, sel.row, ''); break;
    default:
      if (e.key.length === 1 && !ctrl && !e.altKey) { startEdit(''); editor.value = e.key; fb.value = e.key; editor.setSelectionRange(1, 1); }
      else return;                                    // altri tasti: comportamento di default del browser
  }
  e.preventDefault();
});

/** Cella sotto il puntatore, calcolata dalle coordinate (nessun listener per cella). */
function cellAt(e) {
  const r = cellsEl.getBoundingClientRect();
  const col = Math.floor((e.clientX - r.left) / M.colW), row = Math.floor((e.clientY - r.top) / M.rowH);
  return col >= 0 && row >= 0 && col < sheet.cols && row < sheet.rows ? { col, row } : null;
}

cellsEl.addEventListener('pointerdown', (e) => { touchLike = e.pointerType !== 'mouse'; });
cellsEl.addEventListener('click', (e) => {
  if (e.target === editor) return;
  const h = cellAt(e); if (!h) return;
  const same = h.col === sel.col && h.row === sel.row;
  if (same && touchLike && !editing) startEdit();       // su touch: secondo tocco = modifica
  else select(h.col, h.row);
  if (!editing) vp.focus({ preventScroll: true });
});
cellsEl.addEventListener('dblclick', (e) => {
  if (e.target === editor) return;
  const h = cellAt(e); if (!h) return;
  select(h.col, h.row); startEdit();
});
colHdrs.addEventListener('click', (e) => {
  const col = Math.floor((e.clientX - colHdrs.getBoundingClientRect().left) / M.colW);
  if (col >= 0 && col < sheet.cols) { select(col, sel.row); vp.focus({ preventScroll: true }); }
});
rowHdrs.addEventListener('click', (e) => {
  const row = Math.floor((e.clientY - rowHdrs.getBoundingClientRect().top) / M.rowH);
  if (row >= 0 && row < sheet.rows) { select(sel.col, row); vp.focus({ preventScroll: true }); }
});

let lastMetrics = '';
window.addEventListener('resize', () => {
  readMetrics();
  const sig = JSON.stringify(M);
  if (sig !== lastMetrics) { lastMetrics = sig; layout(); } else scheduleRender();
});

/* ═══════════════════════ Salvataggio locale ═══════════════════════ */

let saveTimer = 0;
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet.serialize())); } catch { /* storage non disponibile o pieno */ } }
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }   // debounce: non scrive a ogni tasto
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

/* ═══════════════════════ Toolbar ═══════════════════════ */

const DEMO = {
  A1: '5', A2: '10', A3: '=SOMMA(A1:A2)', A4: '3', A5: '7', A6: '12', A7: 'testo', A8: '8', A9: '1',
  B1: '0', B2: '=A1/B1', B3: '=A7+1', B4: '=A99999', B5: '=PIPPO(1)',
  C1: '=C1', C2: '=D2', D2: '=C2',
  D1: '=CONTA.SE(A1:A10;">5")', E1: '=SOMMA.SE(A1:A10;">5")', F1: '=MEDIA.SE(A1:A10;">5")',
  D4: '=SOMMA(A1:A9)', E4: '=MEDIA(A1:A9)', F4: '=CONTA(A1:A9)', G4: '=CONTA.VALORI(A1:A9)', H4: '=MAX(A1:A9)', I4: '=MIN(A1:A9)',
  D6: '=(A1+A2)*2-A9/4', D7: '=SE(A1>3;"alto";"basso")', D8: '=CONCAT("Totale: ";A3)', D9: '=ARROTONDA(3,14159;2)',
};

function replaceSheet(data) {
  commitPending();
  sheet.load(data);
  sel.col = 0; sel.row = 0;
  vp.scrollTo(0, 0);
  layout();
  saveSoon();
}

$('btnNew').addEventListener('click', () => {
  if (!sheet.cells.size || confirm('Svuotare il foglio? Il contenuto attuale andrà perso.')) { replaceSheet({ cells: {} }); setMsg('Foglio vuoto'); }
});
$('btnDemo').addEventListener('click', () => {
  if (!sheet.cells.size || confirm('Sostituire il contenuto attuale con gli esempi?')) {
    replaceSheet({ cells: DEMO });
    setMsg('Esempi caricati: A3 = 15, B2 = #DIV/0!, C1 = #CIRC!, D1 = 5');
  }
});

/** Test 7 della prova: AA1 → 100 formule dipendenti (AB1:AB100); misura il ricalcolo. */
$('btnPerf').addEventListener('click', () => {
  commitPending();
  sheet.setCell(26, 0, '1');
  for (let i = 0; i < 100; i++) sheet.setCell(27, i, `=$AA$1*${i + 1}`);
  select(26, 0);
  refreshAll();
  const t0 = performance.now();
  const res = sheet.setCell(26, 0, String(2 + Math.floor(Math.random() * 98)));
  repaint(res.changed);
  const ms = performance.now() - t0;
  updateFormulaBar();
  setMsg(`AA1 modificata: ${res.evaluated} formule dipendenti ricalcolate in ${ms.toFixed(1)} ms (limite 300 ms)`);
  saveSoon();
});

function structure(kind) {
  commitPending();
  const ok = { rowAdd: () => sheet.insertRows(sel.row), rowDel: () => sheet.deleteRows(sel.row),
               colAdd: () => sheet.insertCols(sel.col), colDel: () => sheet.deleteCols(sel.col) }[kind]();
  if (!ok) { setMsg('Limite massimo raggiunto (1000 righe × 702 colonne)'); return; }
  sel.col = Math.min(sel.col, sheet.cols - 1); sel.row = Math.min(sel.row, sheet.rows - 1);
  layout(); saveSoon();
  setMsg(`Foglio ${sheet.rows} righe × ${sheet.cols} colonne`);
}
$('btnRowAdd').addEventListener('click', () => structure('rowAdd'));
$('btnRowDel').addEventListener('click', () => structure('rowDel'));
$('btnColAdd').addEventListener('click', () => structure('colAdd'));
$('btnColDel').addEventListener('click', () => structure('colDel'));

/** Esporta i valori calcolati (non le formule) in CSV con separatore ";" e BOM UTF-8 (si apre bene in Excel italiano). */
$('btnCsv').addEventListener('click', () => {
  commitPending();
  const { rows, cols } = sheet.usedRange();
  const field = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let c = 0; c < cols; c++) { const cell = sheet.cells.get(cellKey(c, r)); line.push(cell ? field(formatValue(cell.value)) : ''); }
    lines.push(line.join(';'));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mini-foglio.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setMsg(rows ? `Esportate ${rows} righe × ${cols} colonne` : 'Il foglio è vuoto');
});

$('btnHelp').addEventListener('click', () => $('help').showModal());

/* ═══════════════════════ PWA: installazione, offline, service worker ═══════════════════════ */

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $('btnInstall').hidden = true;
});
window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; setMsg('App installata'); });

function updateNet() {
  netBadge.textContent = navigator.onLine ? 'Online' : 'Offline';
  netBadge.className = 'badge ' + (navigator.onLine ? 'text-bg-success' : 'text-bg-warning');
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

if ('serviceWorker' in navigator) {
  // Percorso RELATIVO: funziona sia in locale, sia su GitHub Pages (/mini-sheet-pwa/), sia su Vercel (/).
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch((err) => console.warn('Service worker non registrato:', err));
  });
}

/* ═══════════════════════ Avvio ═══════════════════════ */

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) sheet.load(JSON.parse(saved));
} catch { /* dati corrotti o storage bloccato: si parte da un foglio vuoto */ }

readMetrics();
lastMetrics = JSON.stringify(M);
layout();
updateNet();
vp.focus({ preventScroll: true });

// Utile per i test e il debug dalla console del browser (non modifica il comportamento dell'app)
window.__sheet = sheet;

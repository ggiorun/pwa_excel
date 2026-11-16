// app.js — interfaccia: griglia virtualizzata, editing, navigazione da tastiera, barra della formula.
import { COLS, ROWS, colToLetters, idOf, colOf, rowOf, nameOf, parseRef } from './coordinates.js';
import { Sheet, FormulaError, ERR_HELP } from './engine.js';

const $ = (id) => document.getElementById(id);
const scroller = $('scroller'), cellsEl = $('cells'), editor = $('editor'), bar = $('formulaBar');
const colhdrIn = $('colhdrIn'), rowhdrIn = $('rowhdrIn'), statusMsg = $('statusMsg');
const STORAGE_KEY = 'mini-sheet-v1';
const OVERSCAN = 2; // righe/colonne extra disegnate fuori dal viewport per uno scroll senza "buchi"

// Le dimensioni vengono lette dal CSS (cambiano su smartphone): una sola fonte di verità.
let CW = 96, RH = 28;
function readSizes() {
  const cs = getComputedStyle(document.documentElement);
  CW = parseFloat(cs.getPropertyValue('--cw')) || CW;
  RH = parseFloat(cs.getPropertyValue('--rh')) || RH;
}

const sheet = new Sheet();
let sel = { c: 0, r: 0 };
let editing = false, editTyped = false; // editTyped: edit iniziato digitando (le frecce confermano)
let win = null; // finestra attualmente disegnata {c0,c1,r0,r1}

/* ------------------------------------------------------------------ rendering */
const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// VIRTUALIZZAZIONE: dal scrollLeft/scrollTop si calcola quali righe/colonne sono visibili e si
// creano nel DOM SOLO quelle (~30×15 + margine) invece di 10.000 elementi. Lo "spazio" #space ha
// la dimensione totale, così la barra di scorrimento nativa rappresenta tutta la griglia.
function render(force = false) {
  const sl = scroller.scrollLeft, st = scroller.scrollTop;
  const c0 = Math.max(0, Math.floor(sl / CW) - OVERSCAN), c1 = Math.min(COLS - 1, Math.ceil((sl + scroller.clientWidth) / CW) + OVERSCAN);
  const r0 = Math.max(0, Math.floor(st / RH) - OVERSCAN), r1 = Math.min(ROWS - 1, Math.ceil((st + scroller.clientHeight) / RH) + OVERSCAN);
  // Le intestazioni stanno fuori dall'area scorrevole: basta traslarle (operazione economica, a ogni frame).
  colhdrIn.style.transform = `translateX(${-sl}px)`;
  rowhdrIn.style.transform = `translateY(${-st}px)`;
  if (!force && win && win.c0 === c0 && win.c1 === c1 && win.r0 === r0 && win.r1 === r1) return; // finestra invariata
  win = { c0, c1, r0, r1 };

  let h = '', ch = '', rh = '';
  for (let c = c0; c <= c1; c++) ch += `<div class="h${c === sel.c ? ' active' : ''}" style="left:${c * CW}px">${colToLetters(c)}</div>`;
  for (let r = r0; r <= r1; r++) {
    rh += `<div class="h${r === sel.r ? ' active' : ''}" style="top:${r * RH}px">${r + 1}</div>`;
    for (let c = c0; c <= c1; c++) {
      const id = idOf(c, r), v = sheet.raw.has(id) ? sheet.getValue(id) : null;
      let cls = 'cell';
      if (v instanceof FormulaError) cls += ' err'; else if (typeof v === 'number') cls += ' num'; else if (typeof v === 'boolean') cls += ' bool';
      if (r === sel.r && c === sel.c) cls += ' sel'; else if (r === sel.r) cls += ' in-row'; else if (c === sel.c) cls += ' in-col';
      const title = v instanceof FormulaError ? ` title="${esc(ERR_HELP[v.code] || '')}"` : '';
      h += `<div class="${cls}" data-i="${id}" style="left:${c * CW}px;top:${r * RH}px"${title}>${v === null ? '' : esc(sheet.display(id))}</div>`;
    }
  }
  cellsEl.innerHTML = h; colhdrIn.innerHTML = ch; rowhdrIn.innerHTML = rh;
}

let ticking = false;
scroller.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; render(); }); // al massimo un render per frame
}, { passive: true });
window.addEventListener('resize', () => { readSizes(); render(true); });

/* ----------------------------------------------------------------- selezione */
function updateBar() {
  $('cellName').textContent = nameOf(idOf(sel.c, sel.r));
  bar.value = sheet.getRaw(idOf(sel.c, sel.r));
  barDirty = false;
}
function ensureVisible() {
  const l = sel.c * CW, t = sel.r * RH, vw = scroller.clientWidth, vh = scroller.clientHeight;
  if (l < scroller.scrollLeft) scroller.scrollLeft = l; else if (l + CW > scroller.scrollLeft + vw) scroller.scrollLeft = l + CW - vw;
  if (t < scroller.scrollTop) scroller.scrollTop = t; else if (t + RH > scroller.scrollTop + vh) scroller.scrollTop = t + RH - vh;
}
function select(c, r) {
  sel = { c: Math.max(0, Math.min(COLS - 1, c)), r: Math.max(0, Math.min(ROWS - 1, r)) };
  updateBar(); ensureVisible(); render(true);
}

/* ------------------------------------------------------------------- editing */
function setCell(c, r, text) {
  const t0 = performance.now();
  const touched = sheet.set(idOf(c, r), text); // ricalcolo incrementale: solo le celle dipendenti
  const ms = performance.now() - t0;
  render(true); save();
  statusMsg.textContent = `${nameOf(idOf(c, r))} aggiornata — ricalcolate ${touched.length} celle in ${ms.toFixed(1)} ms`;
}
function startEdit(initial) {
  editing = true; editTyped = initial != null;
  const left = sel.c * CW, top = sel.r * RH;
  editor.style.left = left + 'px'; editor.style.top = top + 'px'; editor.style.width = Math.max(CW, 160) + 'px';
  editor.value = initial != null ? initial : sheet.getRaw(idOf(sel.c, sel.r));
  editor.hidden = false; editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
  bar.value = editor.value;
}
function endEdit(commit) {
  if (!editing) return;
  editing = false; editor.hidden = true;
  if (commit) setCell(sel.c, sel.r, editor.value); else updateBar();
  scroller.focus({ preventScroll: true });
}
editor.addEventListener('input', () => { bar.value = editor.value; });
editor.addEventListener('keydown', (e) => {
  const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (e.key === 'Enter') { e.preventDefault(); endEdit(true); select(sel.c, sel.r + 1); }          // Invio: conferma e scende
  else if (e.key === 'Tab') { e.preventDefault(); endEdit(true); select(sel.c + (e.shiftKey ? -1 : 1), sel.r); }
  else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
  else if (editTyped && arrows[e.key]) { e.preventDefault(); const [dc, dr] = arrows[e.key]; endEdit(true); select(sel.c + dc, sel.r + dr); }
});
editor.addEventListener('blur', () => { if (editing) endEdit(true); });

// Barra della formula: contenuto GREZZO della cella selezionata, modificabile.
let barDirty = false, barTarget = null;
bar.addEventListener('input', () => { if (!barDirty) barTarget = { ...sel }; barDirty = true; });
function commitBar() {
  if (!barDirty) return;
  barDirty = false;
  setCell(barTarget.c, barTarget.r, bar.value);
}
bar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitBar(); select(sel.c, sel.r + 1); scroller.focus({ preventScroll: true }); }
  else if (e.key === 'Escape') { updateBar(); scroller.focus({ preventScroll: true }); }
});
bar.addEventListener('blur', commitBar);

/* ----------------------------------------------------------------- tastiera */
document.addEventListener('keydown', (e) => {
  if (e.target === bar || e.target === editor || e.target.closest('button')) return;
  const page = Math.max(1, Math.floor(scroller.clientHeight / RH) - 1);
  const k = e.key;
  const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], PageUp: [0, -page], PageDown: [0, page] };
  if (moves[k]) { e.preventDefault(); select(sel.c + moves[k][0], sel.r + moves[k][1]); }
  else if (k === 'Tab') { e.preventDefault(); select(sel.c + (e.shiftKey ? -1 : 1), sel.r); }
  else if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(null); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); setCell(sel.c, sel.r, ''); updateBar(); }
  else if (k === 'Home') { e.preventDefault(); select(0, e.ctrlKey ? 0 : sel.r); } // Home: inizio riga; Ctrl+Home: A1
  else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(k); } // digitare sovrascrive
});

/* -------------------------------------------------------------------- mouse */
cellsEl.addEventListener('mousedown', (e) => {
  const el = e.target.closest('.cell');
  if (!el) return;
  e.preventDefault(); // evita di perdere il focus dalla griglia
  const id = Number(el.dataset.i), c = colOf(id), r = rowOf(id);
  if (editing) endEdit(true);
  commitBar();
  select(c, r); scroller.focus({ preventScroll: true });
});
cellsEl.addEventListener('dblclick', (e) => { if (e.target.closest('.cell')) startEdit(null); });
// Su touch non esiste un doppio clic affidabile: un secondo tocco (senza trascinare) sulla cella già selezionata la modifica.
let touchMoved = false;
cellsEl.addEventListener('touchstart', () => { touchMoved = false; }, { passive: true });
cellsEl.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
cellsEl.addEventListener('touchend', (e) => {
  const el = e.target.closest('.cell');
  if (el && !touchMoved && !editing && e.cancelable && Number(el.dataset.i) === idOf(sel.c, sel.r)) { e.preventDefault(); startEdit(null); }
});

/* --------------------------------------------------- salvataggio / esempi / CSV */
let saveTimer = 0;
function save() { // debounce: scrive su localStorage al massimo ogni 400 ms
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(sheet.raw))); } catch { /* quota o modalità privata */ } }, 400);
}
function bulk(obj, msg) {
  const data = Object.fromEntries(sheet.raw);
  for (const [name, text] of Object.entries(obj)) { const p = parseRef(name); data[idOf(p.c, p.r)] = text; }
  sheet.load(data); updateBar(); render(true); save(); statusMsg.textContent = msg;
}
$('btnDemo').onclick = () => bulk({
  A1: '5', A2: '10', A3: '=SOMMA(A1:A2)', A4: '3', A5: 'ciao', A6: '7',            // caso 1 (A3 = 15)
  B1: '0', B2: '=A1/B1',                                                              // caso 2 (#DIV/0!)
  C1: '=C1',                                                                          // caso 3 (circolare)
  D1: '=CONTA.SE(A1:A10;">5")', D2: '=MEDIA.SE(A1:A10;">5")', D3: '=SOMMA.SE(A1:A10;">5")', // caso 4 (3, 10.667, 32)
  E1: '=MAX(A1:A6)', E2: '=MIN(A1:A6)', E3: '=CONTA(A1:A6)', E4: '=CONTA.VALORI(A1:A6)',
}, 'Esempi caricati: A3=15, B2=#DIV/0!, C1=#CIRC!, D1=3');
$('btnStress').onclick = () => {
  const o = { Z1: '1' };
  for (let r = 1; r <= 100; r++) o['AA' + r] = `=$Z$1*${r}`;
  bulk(o, 'Creato: modifica Z1 e guarda il tempo di ricalcolo di 100 dipendenti nella barra di stato');
  select(25, 0);
};
$('btnClear').onclick = () => { if (confirm('Svuotare tutto il foglio?')) { sheet.clear(); updateBar(); render(true); save(); statusMsg.textContent = 'Foglio svuotato'; } };
$('btnCsv').onclick = () => {
  let maxC = -1, maxR = -1;
  for (const id of sheet.raw.keys()) { maxC = Math.max(maxC, colOf(id)); maxR = Math.max(maxR, rowOf(id)); }
  const rows = [];
  for (let r = 0; r <= maxR; r++) {
    const row = [];
    for (let c = 0; c <= maxC; c++) { const t = sheet.display(idOf(c, r)); row.push(/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t); }
    rows.push(row.join(';')); // ';' è il separatore atteso da Excel in italiano
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'foglio.csv'; a.click(); URL.revokeObjectURL(a.href);
};

/* ----------------------------------------------------------------------- PWA */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('btnInstall').classList.remove('d-none'); });
$('btnInstall').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('btnInstall').classList.add('d-none'); };
window.addEventListener('appinstalled', () => $('btnInstall').classList.add('d-none'));
function net() { const el = $('netState'); el.textContent = navigator.onLine ? 'Online' : 'Offline — funziona dalla cache'; el.classList.toggle('offline', !navigator.onLine); }
window.addEventListener('online', net); window.addEventListener('offline', net);
if ('serviceWorker' in navigator) {
  // Percorso RELATIVO: ./sw.js (non /sw.js) altrimenti su GitHub Pages cercherebbe nella radice del dominio.
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker non registrato:', err)));
}

/* ---------------------------------------------------------------------- avvio */
readSizes();
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) sheet.load(JSON.parse(saved)); } catch { /* dati non validi: parto da foglio vuoto */ }
net(); updateBar(); render(true); scroller.focus({ preventScroll: true });

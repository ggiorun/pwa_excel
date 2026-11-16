// engine.js — parser delle formule + motore di calcolo + gestione delle dipendenze.
// Nessuna libreria esterna: tokenizer, parser ricorsivo e valutatore sono scritti qui.

import { COLS, ROWS, parseRef, inBounds, idOf, colOf, rowOf } from './coordinates.js';

/* ------------------------------------------------------------------ errori */
export class FormulaError {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const ERR = { DIV0: '#DIV/0!', VALUE: '#VALORE!', REF: '#RIF!', NAME: '#NOME?', CIRC: '#CIRC!' };
export const ERR_HELP = {
  '#DIV/0!': 'Divisione per zero',
  '#VALORE!': 'Valore o sintassi non valida (es. testo in un calcolo)',
  '#RIF!': 'Riferimento a una cella fuori dalla griglia',
  '#NOME?': 'Funzione o nome sconosciuto',
  '#CIRC!': 'Riferimento circolare: la cella dipende da sé stessa',
};
const fe = (code) => new FormulaError(code);

/* --------------------------------------------------------------- tokenizer */
// Trasforma il testo della formula in token: numeri, stringhe, identificatori, operatori.
const NUM_RE = /^\s*[+-]?(\d+([.,]\d+)?|[.,]\d+)(e[+-]?\d+)?\s*$/i; // numero "scritto in una cella"
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest))) {
      toks.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw fe(ERR.VALUE); // stringa non chiusa
      toks.push({ t: 'str', v: src.slice(i + 1, end) }); i = end + 1;
    } else if ((m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(rest))) {
      toks.push({ t: 'id', v: m[0] }); i += m[0].length; // nomi funzione (anche CONTA.SE) e riferimenti
    } else if ((m = /^(<=|>=|<>|[+\-*/^(),;:<>=])/.exec(rest))) {
      toks.push({ t: 'op', v: m[0] }); i += m[0].length;
    } else throw fe(ERR.VALUE);
  }
  return toks;
}

/* ------------------------------------------------------------------ parser */
// Grammatica (precedenza crescente):
//   confronto := somma (( = | <> | < | > | <= | >= ) somma)?
//   somma     := prodotto (( + | - ) prodotto)*
//   prodotto  := potenza (( * | / ) potenza)*
//   potenza   := unario ( ^ unario)*
//   unario    := ( + | - ) unario | primario
//   primario  := numero | "testo" | ( confronto ) | NOME( args ) | CELLA [: CELLA]
// Le parentesi riportano la precedenza al livello più basso (confronto).
const FUNCS = {}; // riempita più sotto; serve qui per riconoscere #NOME? già in fase di parsing

function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const next = () => toks[p++];

  function comparison() {
    let a = sum();
    const t = peek();
    if (t && t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { p++; a = { k: 'bin', op: t.v, a, b: sum() }; }
    return a;
  }
  function sum() {
    let a = product();
    while (isOp('+') || isOp('-')) { const op = next().v; a = { k: 'bin', op, a, b: product() }; }
    return a;
  }
  function product() {
    let a = power();
    while (isOp('*') || isOp('/')) { const op = next().v; a = { k: 'bin', op, a, b: power() }; }
    return a;
  }
  function power() {
    let a = unary();
    while (isOp('^')) { next(); a = { k: 'bin', op: '^', a, b: unary() }; }
    return a;
  }
  function unary() {
    if (isOp('-')) { next(); return { k: 'neg', a: unary() }; }
    if (isOp('+')) { next(); return unary(); }
    return primary();
  }
  function cellNode(name) {
    const ref = parseRef(name);
    if (!ref) return null;
    return inBounds(ref.c, ref.r) ? { k: 'ref', c: ref.c, r: ref.r, id: idOf(ref.c, ref.r) } : { k: 'badref' };
  }
  function primary() {
    const t = next();
    if (!t) throw fe(ERR.VALUE);
    if (t.t === 'num' || t.t === 'str') return { k: t.t, v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = comparison();
      if (!isOp(')')) throw fe(ERR.VALUE);
      next(); return e;
    }
    if (t.t === 'id') {
      if (isOp('(')) { // chiamata di funzione
        const name = t.v.toUpperCase();
        if (!FUNCS[name]) throw fe(ERR.NAME);
        next();
        const args = [];
        if (!isOp(')')) {
          do { args.push(comparison()); } while ((isOp(';') || isOp(',')) && next());
        }
        if (!isOp(')')) throw fe(ERR.VALUE);
        next(); return { k: 'call', name, args };
      }
      const a = cellNode(t.v);
      if (!a) throw fe(ERR.NAME); // identificatore che non è una cella né una funzione
      if (isOp(':')) { // intervallo A1:B5
        next();
        const tt = next();
        const b = tt && tt.t === 'id' ? cellNode(tt.v) : null;
        if (!b) throw fe(ERR.VALUE);
        if (a.k === 'badref' || b.k === 'badref') return { k: 'badref' };
        return { k: 'range', c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r), c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r) };
      }
      return a;
    }
    throw fe(ERR.VALUE);
  }

  const ast = comparison();
  if (p < toks.length) throw fe(ERR.VALUE); // token in avanzo (es. "=1 2")
  return ast;
}

// Raccoglie dalle AST le celle singole e gli intervalli da cui la formula dipende.
function collectDeps(n, cells, ranges) {
  if (!n) return;
  if (n.k === 'ref') cells.add(n.id);
  else if (n.k === 'range') ranges.push(n);
  else if (n.k === 'bin') { collectDeps(n.a, cells, ranges); collectDeps(n.b, cells, ranges); }
  else if (n.k === 'neg') collectDeps(n.a, cells, ranges);
  else if (n.k === 'call') n.args.forEach((a) => collectDeps(a, cells, ranges));
}

/* ---------------------------------------------------- conversioni e criteri */
function toNum(v) {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && NUM_RE.test(v)) return Number(v.replace(',', '.'));
  throw fe(ERR.VALUE);
}
function cmp(a, b, op) {
  switch (op) {
    case '=': return a === b; case '<>': return a !== b;
    case '<': return a < b; case '>': return a > b;
    case '<=': return a <= b; case '>=': return a >= b;
  }
  return false;
}
// Criterio di SOMMA.SE / CONTA.SE / MEDIA.SE: ">5", "<=3", "<>0", "=ciao", "ciao", 7
function makePredicate(c) {
  if (typeof c === 'number') return (v) => typeof v === 'number' && v === c;
  const m = /^(>=|<=|<>|>|<|=)?([\s\S]*)$/.exec(String(c ?? ''));
  const op = m[1] || '=';
  const rhs = m[2];
  if (NUM_RE.test(rhs)) { // confronto numerico
    const n = Number(rhs.replace(',', '.'));
    return (v) => (typeof v === 'number' ? cmp(v, n, op) : op === '<>' && !(v instanceof FormulaError));
  }
  const s = rhs.toLowerCase(); // confronto testuale, senza distinzione maiuscole/minuscole
  return (v) => {
    if (v instanceof FormulaError) return false;
    if (typeof v === 'string') return cmp(v.toLowerCase(), s, op);
    return op === '<>'; // numeri/celle vuote sono "diversi" da un testo
  };
}

export function format(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof FormulaError) return v.code;
  if (typeof v === 'number') return String(+v.toPrecision(12));
  if (typeof v === 'boolean') return v ? 'VERO' : 'FALSO';
  return String(v);
}

/* ------------------------------------------------------------------ foglio */
export class Sheet {
  constructor() {
    this.raw = new Map();      // id -> testo digitato dall'utente
    this.cache = new Map();    // id -> valore calcolato (memoizzazione)
    this.formulas = new Map(); // id -> {ast, error, cells:Set, ranges:[]}
    this.rev = new Map();      // dipendenze inverse: id cella -> Set di formule che la usano
    this.rangeUsers = new Set(); // formule che usano almeno un intervallo
    this.visiting = new Set(); // celle in valutazione (serve a trovare i cicli)
  }

  getRaw(id) { return this.raw.get(id) ?? ''; }

  /** Imposta il contenuto di una cella e ricalcola SOLO le celle dipendenti. Ritorna gli id toccati. */
  set(id, text) {
    text = text ?? '';
    this._unregister(id);
    if (text === '') this.raw.delete(id); else this.raw.set(id, text);
    if (text.startsWith('=')) this._register(id, text);
    const affected = this._affected(id);
    for (const a of affected) this.cache.delete(a); // invalida
    for (const a of affected) this.getValue(a);     // ricalcola (la ricorsione rispetta l'ordine delle dipendenze)
    return affected;
  }

  /** Carica molte celle in blocco (calcolo pigro al primo getValue). */
  load(obj) {
    this.raw.clear(); this.cache.clear(); this.formulas.clear(); this.rev.clear(); this.rangeUsers.clear();
    for (const [k, text] of Object.entries(obj)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 0 || id >= ROWS * COLS || typeof text !== 'string' || text === '') continue;
      this.raw.set(id, text);
      if (text.startsWith('=')) this._register(id, text);
    }
  }
  clear() { this.load({}); }

  _register(id, text) {
    const meta = { ast: null, error: null, cells: new Set(), ranges: [] };
    try {
      meta.ast = parse(text.slice(1));
      collectDeps(meta.ast, meta.cells, meta.ranges);
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e;
      meta.error = e; // errore di sintassi/nome: verrà mostrato come valore della cella
    }
    this.formulas.set(id, meta);
    for (const d of meta.cells) {
      if (!this.rev.has(d)) this.rev.set(d, new Set());
      this.rev.get(d).add(id);
    }
    if (meta.ranges.length) this.rangeUsers.add(id);
  }
  _unregister(id) {
    const meta = this.formulas.get(id);
    if (!meta) return;
    for (const d of meta.cells) {
      const s = this.rev.get(d);
      if (s) { s.delete(id); if (!s.size) this.rev.delete(d); }
    }
    this.rangeUsers.delete(id);
    this.formulas.delete(id);
  }

  // Visita in ampiezza il grafo inverso: la cella modificata + tutte quelle che (anche indirettamente) la usano.
  _affected(id) {
    const out = [id], seen = new Set(out);
    for (let i = 0; i < out.length; i++) {
      const cur = out[i], c = colOf(cur), r = rowOf(cur);
      const direct = this.rev.get(cur);
      if (direct) for (const f of direct) if (!seen.has(f)) { seen.add(f); out.push(f); }
      for (const f of this.rangeUsers) { // formule con intervalli: controllo se la cella ricade in un range
        if (seen.has(f)) continue;
        for (const g of this.formulas.get(f).ranges) {
          if (c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2) { seen.add(f); out.push(f); break; }
        }
      }
    }
    return out;
  }

  /** Valore calcolato di una cella: null (vuota), number, string, boolean o FormulaError. */
  getValue(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    if (this.visiting.has(id)) return fe(ERR.CIRC); // già in valutazione => ciclo
    this.visiting.add(id);
    let v;
    try { v = this._compute(id); }
    catch (e) {
      if (e instanceof FormulaError) v = e;
      else if (e instanceof RangeError) v = fe(ERR.VALUE); // catene di dipendenze troppo profonde
      else throw e;
    } finally { this.visiting.delete(id); }
    this.cache.set(id, v);
    return v;
  }

  _compute(id) {
    const raw = this.raw.get(id);
    if (raw === undefined) return null;
    if (raw[0] === '=') {
      const meta = this.formulas.get(id);
      if (meta.error) throw meta.error;
      const v = this._eval(meta.ast, id);
      if (v && v.k === 'range') throw fe(ERR.VALUE); // "=A1:B2" da solo non è un valore
      return v;
    }
    return NUM_RE.test(raw) ? Number(raw.trim().replace(',', '.')) : raw;
  }

  display(id) { return format(this.getValue(id)); }

  /* ------------------------------------------------------------ valutazione */
  _eval(n, self) {
    switch (n.k) {
      case 'num': case 'str': return n.v;
      case 'badref': throw fe(ERR.REF);
      case 'range': return n; // gestito dalle funzioni
      case 'ref': {
        const v = this.getValue(n.id);
        if (v instanceof FormulaError) throw v; // gli errori si propagano
        return v;
      }
      case 'neg': return -toNum(this._scalar(n.a, self));
      case 'bin': {
        const a = this._scalar(n.a, self), b = this._scalar(n.b, self);
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          const num = (typeof a !== 'string' && typeof b !== 'string');
          return num ? cmp(toNum(a), toNum(b), n.op) : cmp(String(a ?? '').toLowerCase(), String(b ?? '').toLowerCase(), n.op);
        }
        const x = toNum(a), y = toNum(b);
        if (n.op === '+') return x + y;
        if (n.op === '-') return x - y;
        if (n.op === '*') return x * y;
        if (n.op === '^') return Math.pow(x, y);
        if (y === 0) throw fe(ERR.DIV0);
        return x / y;
      }
      case 'call': return FUNCS[n.name](this, n.args, self);
    }
    throw fe(ERR.VALUE);
  }
  _scalar(n, self) {
    const v = this._eval(n, self);
    if (v && v.k === 'range') throw fe(ERR.VALUE);
    return v;
  }
  // Valori di un intervallo in ordine riga per riga. Le celle vuote non vengono calcolate (null).
  // Un intervallo che contiene la cella stessa la ignora (così =SOMMA(A1:CV100) in E1 non è circolare).
  _rangeVals(g, self) {
    const out = [];
    for (let r = g.r1; r <= g.r2; r++) {
      for (let c = g.c1; c <= g.c2; c++) {
        const id = idOf(c, r);
        out.push(id === self || !this.raw.has(id) ? null : this.getValue(id));
      }
    }
    return out;
  }
  // Appiattisce gli argomenti (celle, intervalli, valori) in un array; gli errori restano come oggetti.
  _flat(args, self) {
    const out = [];
    for (const a of args) {
      if (a.k === 'range') for (const v of this._rangeVals(a, self)) out.push(v);
      else if (a.k === 'ref') out.push(this.getValue(a.id));
      else out.push(this._scalar(a, self));
    }
    return out;
  }
}

/* ---------------------------------------------------------------- funzioni */
const nums = (vs) => {
  const o = [];
  for (const v of vs) { if (v instanceof FormulaError) throw v; if (typeof v === 'number') o.push(v); }
  return o;
};
const asRange = (n) => {
  if (n.k === 'range') return n;
  if (n.k === 'ref') return { k: 'range', c1: n.c, r1: n.r, c2: n.c, r2: n.r };
  throw fe(ERR.VALUE);
};
const sumOf = (a) => a.reduce((s, x) => s + x, 0);

// Per le funzioni condizionali: ritorna i numeri della "range somma" che soddisfano il criterio.
function conditional(sh, args, self, withSumRange) {
  if (args.length < 2 || args.length > (withSumRange ? 3 : 2)) throw fe(ERR.VALUE);
  const g = asRange(args[0]);
  const test = makePredicate(sh._scalar(args[1], self));
  const crit = sh._rangeVals(g, self);
  let target = crit;
  if (withSumRange && args[2]) { // intervallo di somma: stessa forma, partendo dal suo angolo in alto a sinistra
    const s = asRange(args[2]);
    const g2 = { c1: s.c1, r1: s.r1, c2: s.c1 + (g.c2 - g.c1), r2: s.r1 + (g.r2 - g.r1) };
    if (g2.c2 >= COLS || g2.r2 >= ROWS) throw fe(ERR.REF);
    target = sh._rangeVals(g2, self);
  }
  const out = [];
  crit.forEach((v, i) => { if (test(v)) out.push(target[i]); });
  return out;
}

Object.assign(FUNCS, {
  SOMMA: (sh, a, s) => sumOf(nums(sh._flat(a, s))),
  MEDIA: (sh, a, s) => { const n = nums(sh._flat(a, s)); if (!n.length) throw fe(ERR.DIV0); return sumOf(n) / n.length; },
  CONTA: (sh, a, s) => sh._flat(a, s).filter((v) => typeof v === 'number').length,
  'CONTA.VALORI': (sh, a, s) => sh._flat(a, s).filter((v) => v !== null).length,
  MAX: (sh, a, s) => { const n = nums(sh._flat(a, s)); return n.length ? n.reduce((m, x) => (x > m ? x : m)) : 0; },
  MIN: (sh, a, s) => { const n = nums(sh._flat(a, s)); return n.length ? n.reduce((m, x) => (x < m ? x : m)) : 0; },
  'SOMMA.SE': (sh, a, s) => sumOf(nums(conditional(sh, a, s, true))),
  'CONTA.SE': (sh, a, s) => conditional(sh, a, s, false).length,
  'MEDIA.SE': (sh, a, s) => { const n = nums(conditional(sh, a, s, true)); if (!n.length) throw fe(ERR.DIV0); return sumOf(n) / n.length; },
  // Funzioni extra (bonus)
  SE: (sh, a, s) => {
    if (a.length < 2 || a.length > 3) throw fe(ERR.VALUE);
    const c = sh._scalar(a[0], s);
    const ok = typeof c === 'boolean' ? c : toNum(c) !== 0;
    return ok ? sh._scalar(a[1], s) : (a[2] ? sh._scalar(a[2], s) : false); // valuta solo il ramo scelto
  },
  CONCAT: (sh, a, s) => sh._flat(a, s).map((v) => { if (v instanceof FormulaError) throw v; return format(v); }).join(''),
  ARROTONDA: (sh, a, s) => {
    if (a.length < 1 || a.length > 2) throw fe(ERR.VALUE);
    const x = toNum(sh._scalar(a[0], s)), f = Math.pow(10, a[1] ? toNum(sh._scalar(a[1], s)) : 0);
    return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
  },
});

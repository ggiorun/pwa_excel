/**
 * engine.js — motore del foglio di calcolo (nessuna dipendenza dal DOM).
 *
 * Struttura:
 *   1. Errori (#DIV/0!, #VALORE!, #RIF!, #NOME?, #CIRC!, #NUM!)
 *   2. Tokenizer + Parser (discesa ricorsiva) → AST
 *   3. Funzioni (SOMMA, MEDIA, CONTA, ... + SE, CONCAT, ARROTONDA)
 *   4. Classe Sheet: celle, grafo delle dipendenze, ricalcolo incrementale
 *
 * Separatore degli argomenti: ";"  (es. =SOMMA.SE(A1:A10;">5")).
 */
import {
  cellKey, keyCol, keyRow, parseRef, colToLabel,
  MIN_ROWS, MIN_COLS, MAX_ROWS, MAX_COLS,
} from './coordinates.js';

/* ───────────────────────── 1. ERRORI ───────────────────────── */

export class SheetError {
  constructor(code, msg) { this.code = code; this.msg = msg; }
  toString() { return this.code; }
}

export const ERR = {
  DIV0:   new SheetError('#DIV/0!',  'Divisione per zero'),
  VALORE: new SheetError('#VALORE!', 'Tipo di valore non valido per questa operazione'),
  RIF:    new SheetError('#RIF!',    'Riferimento a una cella non valida o eliminata'),
  NOME:   new SheetError('#NOME?',   'Funzione o nome non riconosciuto'),
  CIRC:   new SheetError('#CIRC!',   'Riferimento circolare: la formula dipende (anche indirettamente) da se stessa'),
  NUM:    new SheetError('#NUM!',    'Risultato numerico non valido'),
};
const ERR_BY_CODE = Object.fromEntries(Object.values(ERR).map((e) => [e.code, e]));
const syntaxError = (msg) => new SheetError('#VALORE!', 'Sintassi non valida: ' + msg);

/* ───────────────────── Valori e conversioni ───────────────────── */
// Un valore di cella è: number | string | boolean | SheetError | null (cella vuota)

const NUM_RE = /^\s*[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?\s*$/;

/** Converte "3.14" o "3,14" in numero; null se il testo non è numerico. */
export function parseNumber(s) {
  return NUM_RE.test(s) ? parseFloat(s.replace(',', '.')) : null;
}

/** Contenuto digitato (non formula) → numero se possibile, altrimenti testo. */
function parseLiteral(raw) {
  const n = parseNumber(raw);
  return n === null ? raw : n;
}

/** Valore → testo da mostrare nella cella. */
export function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof SheetError) return v.code;
  if (typeof v === 'boolean') return v ? 'VERO' : 'FALSO';
  if (typeof v === 'number') return String(Number(v.toPrecision(12))); // 0.1+0.2 → 0.3
  return v;
}

const toText = (v) => (v === null ? '' : formatValue(v));

function toNum(v) {
  if (v instanceof SheetError) return v;
  if (v === null) return 0;                 // cella vuota = 0 nelle operazioni aritmetiche
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseNumber(v);
  return n === null ? ERR.VALORE : n;       // testo non numerico → #VALORE!
}

function toBool(v) {
  if (v instanceof SheetError) return v;
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return ERR.VALORE;
}

const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);

/** Confronto tra valori (numeri < testo < booleani, testo senza maiuscole). */
function cmpValues(a, b) {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

const sameValue = (a, b) =>
  a === b || (a instanceof SheetError && b instanceof SheetError && a.code === b.code);

/* ───────────────────────── 2. TOKENIZER ───────────────────────── */

// Espressioni regolari "sticky" (flag y): provano a riconoscere un token esattamente in posizione lastIndex.
const RE = {
  space: /\s+/y,
  err:   /#(?:DIV\/0!|VALORE!|RIF!|NOME\?|CIRC!|NUM!)/y,
  num:   /(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y,
  id:    /\$?[A-Za-z_][A-Za-z0-9_.]*(?:\$\d+)?/y,   // funzioni (CONTA.SE), riferimenti (A1, $A$1), nomi
  op:    /<=|>=|<>|[-+*\/^&=<>():;,]/y,
};

/** Trasforma il testo della formula (senza "=") in una lista di token. */
function tokenize(src) {
  const toks = [];
  let i = 0;
  const match = (re) => { re.lastIndex = i; const r = re.exec(src); return r ? r[0] : null; };
  while (i < src.length) {
    let s;
    if ((s = match(RE.space))) { i += s.length; continue; }
    if (src[i] === '"') {                       // stringa tra virgolette ("" = virgoletta letterale)
      let j = i + 1, str = '';
      for (;;) {
        if (j >= src.length) throw syntaxError('stringa non chiusa');
        if (src[j] === '"') { if (src[j + 1] === '"') { str += '"'; j += 2; continue; } break; }
        str += src[j++];
      }
      toks.push({ t: 'str', v: str });
      i = j + 1;
      continue;
    }
    if ((s = match(RE.err)))      toks.push({ t: 'err', v: s });
    else if ((s = match(RE.num))) toks.push({ t: 'num', v: parseFloat(s.replace(',', '.')) });
    else if ((s = match(RE.id)))  toks.push({ t: 'id', v: s });
    else if ((s = match(RE.op)))  toks.push({ t: 'op', v: s });
    else throw syntaxError(`carattere "${src[i]}" non valido`);
    i += s.length;
  }
  return toks;
}

/* ───────────────────────── PARSER ───────────────────────── */
/*
 * Grammatica (dalla precedenza più bassa alla più alta):
 *   cmp     := concat (("=" | "<>" | "<" | ">" | "<=" | ">=") concat)*
 *   concat  := add ("&" add)*
 *   add     := mul (("+" | "-") mul)*
 *   mul     := pow (("*" | "/") pow)*
 *   pow     := unary ("^" pow)?
 *   unary   := ("-" | "+") unary | primary
 *   primary := numero | "stringa" | #ERRORE | "(" cmp ")" | FUNZIONE "(" [cmp (";" cmp)*] ")"
 *            | RIFERIMENTO [":" RIFERIMENTO] | VERO | FALSO | nome
 * Le parentesi sono gestite da primary → "(" cmp ")", che ripassa dalla precedenza più bassa.
 */
class Parser {
  constructor(toks, rows, cols) {
    this.t = toks; this.p = 0; this.rows = rows; this.cols = cols;
    this.refs = new Set();   // chiavi delle celle singole lette dalla formula
    this.ranges = [];        // intervalli letti dalla formula
  }
  peek() { return this.t[this.p]; }
  isOp(v) { const k = this.t[this.p]; return !!k && k.t === 'op' && k.v === v; }
  eat(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  expect(v) { if (!this.eat(v)) throw syntaxError(`atteso "${v}"`); }

  parse() {
    const node = this.cmp();
    if (this.p < this.t.length) throw syntaxError('testo inatteso dopo la fine della formula');
    return node;
  }

  /** Livello binario generico associativo a sinistra. */
  binary(next, ops) {
    let left = next.call(this);
    for (;;) {
      const k = this.peek();
      if (k && k.t === 'op' && ops.includes(k.v)) {
        this.p++;
        left = { t: 'bin', op: k.v, a: left, b: next.call(this) };
      } else return left;
    }
  }
  cmp()    { return this.binary(this.concat, ['=', '<>', '<', '>', '<=', '>=']); }
  concat() { return this.binary(this.add, ['&']); }
  add()    { return this.binary(this.mul, ['+', '-']); }
  mul()    { return this.binary(this.pow, ['*', '/']); }
  pow() {
    const left = this.unary();
    return this.eat('^') ? { t: 'bin', op: '^', a: left, b: this.pow() } : left; // associativa a destra
  }
  unary() {
    if (this.eat('-')) return { t: 'neg', a: this.unary() };
    if (this.eat('+')) return this.unary();
    return this.primary();
  }

  primary() {
    const k = this.t[this.p++];
    if (!k) throw syntaxError('formula incompleta');
    if (k.t === 'num') return { t: 'num', v: k.v };
    if (k.t === 'str') return { t: 'str', v: k.v };
    if (k.t === 'err') return { t: 'err', v: ERR_BY_CODE[k.v] };
    if (k.t === 'op' && k.v === '(') { const n = this.cmp(); this.expect(')'); return n; }
    if (k.t === 'id') {
      if (this.isOp('(')) { this.p++; return this.call(k.v); }
      const a = parseRef(k.v);
      if (a) {
        if (this.eat(':')) {                      // intervallo A1:B5
          const n2 = this.t[this.p++];
          const b = n2 && n2.t === 'id' ? parseRef(n2.v) : null;
          if (!b) throw syntaxError('intervallo non valido');
          return this.range(a, b);
        }
        return this.ref(a);
      }
      const up = k.v.toUpperCase();
      if (up === 'VERO') return { t: 'bool', v: true };
      if (up === 'FALSO') return { t: 'bool', v: false };
      return { t: 'name', v: k.v };               // nome sconosciuto → #NOME? in valutazione
    }
    throw syntaxError(`simbolo "${k.v}" inatteso`);
  }

  call(name) {
    const args = [];
    if (!this.eat(')')) {
      do { args.push(this.cmp()); } while (this.eat(';') || this.eat(','));
      this.expect(')');
    }
    return { t: 'call', name: name.toUpperCase(), args };
  }

  ref(a) {
    if (a.col < this.cols && a.row < this.rows) this.refs.add(cellKey(a.col, a.row));
    return { t: 'ref', col: a.col, row: a.row };
  }

  range(a, b) {
    const g = {
      t: 'range',
      c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row),
      c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row),
    };
    if (g.c1 < this.cols && g.r1 < this.rows) {   // registro solo la parte dentro la griglia
      this.ranges.push({ c1: g.c1, r1: g.r1, c2: Math.min(g.c2, this.cols - 1), r2: Math.min(g.r2, this.rows - 1) });
    }
    return g;
  }
}

/** Analizza il testo di una formula (senza "=") → { ast, refs, ranges }. Lancia SheetError se non valida. */
function parseFormula(text, rows, cols) {
  const p = new Parser(tokenize(text), rows, cols);
  const ast = p.parse();
  return { ast, refs: p.refs, ranges: p.ranges };
}

/* ───────────────────────── CRITERI (SOMMA.SE, ...) ───────────────────────── */

/**
 * Trasforma un criterio ( 5, ">5", "<=10", "<>testo", "ab*", "=" ) in un oggetto { test(valore) }.
 * test(null) dice se una cella VUOTA soddisfa il criterio (es. "<>5" sì, ">5" no).
 */
function makeCriterion(cv) {
  if (typeof cv === 'number') return { test: (v) => typeof v === 'number' && v === cv };
  if (typeof cv === 'boolean') return { test: (v) => v === cv };
  let s = cv === null ? '' : String(cv);
  let op = '=';
  const m = /^(<=|>=|<>|<|>|=)/.exec(s);
  if (m) { op = m[1]; s = s.slice(op.length); }

  const blank = (v) => v === null || v === '';
  if (s === '') return { test: (v) => (op === '=' ? blank(v) : op === '<>' ? !blank(v) : false) };

  const n = parseNumber(s);
  if (n !== null) {                                   // criterio numerico: >5, <=3, =7 ...
    return {
      test: (v) => {
        if (v instanceof SheetError) return false;
        if (typeof v !== 'number') return op === '<>';
        switch (op) {
          case '=': return v === n;  case '<>': return v !== n;
          case '<': return v < n;    case '>': return v > n;
          case '<=': return v <= n;  default: return v >= n;
        }
      },
    };
  }

  const low = s.toLowerCase();                        // criterio testuale
  if (op === '=' || op === '<>') {                    // supporta i caratteri jolly * e ?
    const re = new RegExp('^' + low.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '[\\s\\S]') + '$');
    return {
      test: (v) => {
        if (v instanceof SheetError) return false;
        const hit = typeof v === 'string' && re.test(v.toLowerCase());
        return op === '=' ? hit : !hit;
      },
    };
  }
  return {
    test: (v) => {
      if (typeof v !== 'string') return false;
      const x = v.toLowerCase();
      return op === '<' ? x < low : op === '>' ? x > low : op === '<=' ? x <= low : x >= low;
    },
  };
}

/* ───────────────────────── 3. FUNZIONI ───────────────────────── */
// Ogni funzione riceve (engine, nodiArgomento): così può valutare gli argomenti come vuole
// (intervalli, valori, valutazione "pigra" per SE). Deve restituire un valore.

const ALIASES = {
  SUM: 'SOMMA', AVERAGE: 'MEDIA', COUNT: 'CONTA', COUNTA: 'CONTA.VALORI',
  SUMIF: 'SOMMA.SE', COUNTIF: 'CONTA.SE', AVERAGEIF: 'MEDIA.SE',
  IF: 'SE', ROUND: 'ARROTONDA', CONCATENATE: 'CONCAT', CONCATENA: 'CONCAT',
};

const FUNCS = {
  SOMMA:  (e, a) => { const v = e.nums(a); return v instanceof SheetError ? v : v.reduce((s, x) => s + x, 0); },
  MEDIA:  (e, a) => { const v = e.nums(a); return v instanceof SheetError ? v : v.length ? v.reduce((s, x) => s + x, 0) / v.length : ERR.DIV0; },
  CONTA:  (e, a) => { const v = e.nums(a, true); return v instanceof SheetError ? v : v.length; },
  MAX:    (e, a) => { const v = e.nums(a); return v instanceof SheetError ? v : v.reduce((m, x) => (x > m ? x : m), v.length ? v[0] : 0); },
  MIN:    (e, a) => { const v = e.nums(a); return v instanceof SheetError ? v : v.reduce((m, x) => (x < m ? x : m), v.length ? v[0] : 0); },

  'CONTA.VALORI': (e, a) => {                         // celle non vuote (testo, numeri, errori)
    if (!a.length) return ERR.VALORE;
    let n = 0;
    for (const x of a) {
      if (x.t === 'range') {
        const g = e.checkRange(x); if (g instanceof SheetError) return g;
        e.eachCell(g, () => { n++; });
      } else if (e.evalNode(x) !== null) n++;
    }
    return n;
  },

  'SOMMA.SE': (e, a) => {                             // SOMMA.SE(intervallo; criterio; [intervallo_somma])
    const c = e.condArgs(a); if (c instanceof SheetError) return c;
    let total = 0, err = null;
    e.forMatching(c.range, c.crit, (col, row) => {
      if (err) return;
      const v = e.readOffset(c, col, row);
      if (v instanceof SheetError) err = v; else if (typeof v === 'number') total += v;
    });
    return err || total;
  },
  'CONTA.SE': (e, a) => {                             // CONTA.SE(intervallo; criterio)
    if (a.length !== 2) return ERR.VALORE;
    const c = e.condArgs(a); if (c instanceof SheetError) return c;
    let n = 0;
    e.forMatching(c.range, c.crit, () => { n++; });
    return n;
  },
  'MEDIA.SE': (e, a) => {                             // MEDIA.SE(intervallo; criterio; [intervallo_media])
    const c = e.condArgs(a); if (c instanceof SheetError) return c;
    let total = 0, n = 0, err = null;
    e.forMatching(c.range, c.crit, (col, row) => {
      if (err) return;
      const v = e.readOffset(c, col, row);
      if (v instanceof SheetError) err = v; else if (typeof v === 'number') { total += v; n++; }
    });
    return err || (n ? total / n : ERR.DIV0);
  },

  SE: (e, a) => {                                     // SE(condizione; se_vero; [se_falso]) — valutazione pigra
    if (a.length < 2 || a.length > 3) return ERR.VALORE;
    const b = toBool(e.evalNode(a[0]));
    if (b instanceof SheetError) return b;
    return b ? e.evalNode(a[1]) : a[2] ? e.evalNode(a[2]) : false;
  },
  CONCAT: (e, a) => {
    if (!a.length) return ERR.VALORE;
    let out = '';
    for (const x of a) {
      if (x.t === 'range') {
        const g = e.checkRange(x); if (g instanceof SheetError) return g;
        let err = null;
        e.eachInRange(g, (v) => { if (v instanceof SheetError) err = err || v; else out += toText(v); }, true);
        if (err) return err;
      } else {
        const v = e.evalNode(x); if (v instanceof SheetError) return v;
        out += toText(v);
      }
    }
    return out;
  },
  ARROTONDA: (e, a) => {                              // ARROTONDA(numero; [cifre]) — .5 arrotonda "via dallo zero"
    if (a.length < 1 || a.length > 2) return ERR.VALORE;
    const x = toNum(e.evalNode(a[0])); if (x instanceof SheetError) return x;
    const d = a[1] ? toNum(e.evalNode(a[1])) : 0; if (d instanceof SheetError) return d;
    const k = Math.trunc(d), abs = Math.abs(x);
    let r = Number(Math.round(Number(abs + 'e' + k)) + 'e' + -k);
    if (Number.isNaN(r)) r = Math.round(abs * 10 ** k) / 10 ** k;
    return x < 0 ? -r : r;
  },
};

/* ───────────────────────── 4. FOGLIO ───────────────────────── */

const DONE = 0, STALE = 1, BUSY = 2;  // stato di valutazione di una cella formula

export class Sheet {
  constructor(rows = MIN_ROWS, cols = MIN_COLS) {
    this.rows = rows;
    this.cols = cols;
    this.cells = new Map();       // chiave → cella; contiene SOLO le celle non vuote
    this.dependents = new Map();  // chiave cella singola → Set(chiavi delle formule che la leggono)
    this.colIndex = new Map();    // colonna → Set(chiavi delle formule con un intervallo che attraversa la colonna)
    this.cur = null;              // cella formula in valutazione (serve per i casi tipo =SOMMA(A1:CV100) in E1)
  }

  /* ── accesso ── */
  rawOf(col, row) { const c = this.cells.get(cellKey(col, row)); return c ? c.raw : ''; }
  valueOf(col, row) { const c = this.cells.get(cellKey(col, row)); return c ? this.readKey(cellKey(col, row)) : null; }

  /** Ultima riga/colonna usata (per l'esportazione CSV). */
  usedRange() {
    let rows = 0, cols = 0;
    for (const c of this.cells.values()) { if (c.row + 1 > rows) rows = c.row + 1; if (c.col + 1 > cols) cols = c.col + 1; }
    return { rows, cols };
  }

  /* ── modifica di una cella ── */

  /**
   * Imposta il contenuto grezzo di una cella e ricalcola SOLO le celle che ne dipendono.
   * @returns {{changed:Set<number>, evaluated:number}} chiavi da ridisegnare e n° di formule ricalcolate.
   */
  setCell(col, row, raw) {
    raw = raw == null ? '' : String(raw);
    const key = cellKey(col, row);
    const old = this.cells.get(key);
    if (old) this.unregister(old);
    if (raw.trim() === '') this.cells.delete(key);
    else this.cells.set(key, this.makeCell(key, col, row, raw));
    return this.recalc([key]);
  }

  makeCell(key, col, row, raw) {
    const c = { key, col, row, raw, ast: null, refs: null, ranges: null, value: null, state: DONE };
    if (raw[0] === '=') {
      try {
        const p = parseFormula(raw.slice(1), this.rows, this.cols);
        c.ast = p.ast; c.refs = p.refs; c.ranges = p.ranges; c.state = STALE;
      } catch (e) {
        if (!(e instanceof SheetError)) throw e;
        c.value = e;                                  // formula con errore di sintassi
      }
    } else c.value = parseLiteral(raw);
    this.register(c);
    return c;
  }

  /* ── grafo delle dipendenze ──
   * Celle singole:  dependents[cella letta] = { formule che la leggono }
   * Intervalli:     NON si creano 10.000 archi per A1:CV100; si indicizza la formula per colonna
   *                 (colIndex) e a ricalcolo si controlla se la cella modificata cade nell'intervallo.
   */
  register(c) {
    if (!c.ast) return;
    for (const k of c.refs) {
      let s = this.dependents.get(k);
      if (!s) this.dependents.set(k, (s = new Set()));
      s.add(c.key);
    }
    for (const g of c.ranges) {
      for (let col = g.c1; col <= g.c2; col++) {
        let s = this.colIndex.get(col);
        if (!s) this.colIndex.set(col, (s = new Set()));
        s.add(c.key);
      }
    }
  }
  unregister(c) {
    if (!c.ast) return;
    for (const k of c.refs) { const s = this.dependents.get(k); if (s) { s.delete(c.key); if (!s.size) this.dependents.delete(k); } }
    for (const g of c.ranges) {
      for (let col = g.c1; col <= g.c2; col++) { const s = this.colIndex.get(col); if (s) { s.delete(c.key); if (!s.size) this.colIndex.delete(col); } }
    }
  }

  /** Formule che leggono direttamente la cella `key`. */
  dependentsOf(key) {
    const out = [];
    const direct = this.dependents.get(key);
    if (direct) for (const f of direct) out.push(f);
    const bucket = this.colIndex.get(keyCol(key));
    if (bucket) {
      const col = keyCol(key), row = keyRow(key);
      for (const f of bucket) {
        const cell = this.cells.get(f);
        if (cell && cell.ranges.some((g) => g.c1 <= col && col <= g.c2 && g.r1 <= row && row <= g.r2)) out.push(f);
      }
    }
    return out;
  }

  /* ── ricalcolo incrementale ──
   * 1) trova (a catena) tutte le formule che dipendono dalle celle modificate ("dirty");
   * 2) le marca STALE; 3) le valuta con memoizzazione: leggere una cella STALE la valuta al volo,
   *    quindi ogni cella è calcolata una sola volta e dopo le sue dipendenze (ordine topologico implicito).
   * Una cella letta mentre è BUSY è un riferimento circolare → #CIRC!.
   */
  recalc(startKeys) {
    const dirty = new Set();
    const stack = [...startKeys];
    while (stack.length) {
      const k = stack.pop();
      if (dirty.has(k)) continue;
      dirty.add(k);
      for (const d of this.dependentsOf(k)) if (!dirty.has(d)) stack.push(d);
    }
    const before = new Map();
    for (const k of dirty) {
      const c = this.cells.get(k);
      if (c && c.ast) { before.set(k, c.value); c.state = STALE; }
    }
    for (const k of dirty) {
      const c = this.cells.get(k);
      if (c && c.state === STALE) this.evalCell(c);
    }
    const changed = new Set(startKeys);
    for (const [k, old] of before) if (!sameValue(old, this.cells.get(k).value)) changed.add(k);
    return { changed, evaluated: before.size };
  }

  /** Ricalcola tutte le formule (dopo caricamento o ristrutturazione). */
  recalcAll() {
    let n = 0;
    for (const c of this.cells.values()) if (c.ast) { c.state = STALE; n++; }
    for (const c of this.cells.values()) if (c.state === STALE) this.evalCell(c);
    return n;
  }

  readKey(key) {
    const c = this.cells.get(key);
    if (!c) return null;
    if (c.state === BUSY) return ERR.CIRC;            // la cella è già in valutazione → ciclo
    if (c.state === STALE) this.evalCell(c);
    return c.value;
  }

  evalCell(c) {
    const prev = this.cur;
    this.cur = c;
    c.state = BUSY;
    let v;
    try {
      v = this.evalNode(c.ast);
    } catch (err) {
      if (!(err instanceof RangeError)) console.error(err);
      v = new SheetError('#VALORE!', err instanceof RangeError ? 'Catena di dipendenze troppo lunga' : 'Errore interno di calcolo');
    } finally {
      this.cur = prev;
    }
    c.value = v === null ? 0 : v;                     // =A1 con A1 vuota vale 0
    c.state = DONE;
  }

  /* ── valutazione dell'AST ── */
  evalNode(n) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': return n.v;
      case 'name': return new SheetError('#NOME?', `Nome non riconosciuto: ${n.v}`);
      case 'range': return ERR.VALORE;                 // un intervallo da solo non è un valore
      case 'ref':
        if (n.col >= this.cols || n.row >= this.rows) return ERR.RIF;
        return this.readKey(cellKey(n.col, n.row));
      case 'neg': { const x = toNum(this.evalNode(n.a)); return x instanceof SheetError ? x : -x; }
      case 'bin': return this.evalBin(n);
      case 'call': {
        const f = FUNCS[ALIASES[n.name] || n.name];
        return f ? f(this, n.args) : new SheetError('#NOME?', `Funzione sconosciuta: ${n.name}`);
      }
      default: return ERR.VALORE;
    }
  }

  evalBin(n) {
    const x = this.evalNode(n.a); if (x instanceof SheetError) return x;
    const y = this.evalNode(n.b); if (y instanceof SheetError) return y;
    switch (n.op) {
      case '&': return toText(x) + toText(y);
      case '=':  return cmpValues(x, y) === 0;
      case '<>': return cmpValues(x, y) !== 0;
      case '<':  return cmpValues(x, y) < 0;
      case '>':  return cmpValues(x, y) > 0;
      case '<=': return cmpValues(x, y) <= 0;
      case '>=': return cmpValues(x, y) >= 0;
    }
    const a = toNum(x); if (a instanceof SheetError) return a;
    const b = toNum(y); if (b instanceof SheetError) return b;
    let r;
    switch (n.op) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '/': if (b === 0) return ERR.DIV0; r = a / b; break;
      case '^': r = a ** b; break;
    }
    return Number.isFinite(r) ? r : ERR.NUM;
  }

  /* ── helper per intervalli ── */

  /** Nodo ref/range → intervallo normalizzato; #RIF! se esce dalla griglia; #VALORE! se non è un riferimento. */
  checkRange(n) {
    if (n.t === 'ref') n = { t: 'range', c1: n.col, r1: n.row, c2: n.col, r2: n.row };
    if (n.t !== 'range') return ERR.VALORE;
    if (n.c2 >= this.cols || n.r2 >= this.rows) return ERR.RIF;
    return n;
  }

  /** Visita le celle NON vuote dell'intervallo (senza valutarle). */
  eachCell(g, fn) {
    const area = (g.c2 - g.c1 + 1) * (g.r2 - g.r1 + 1);
    if (area <= this.cells.size) {
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const cell = this.cells.get(cellKey(c, r)); if (cell) fn(cell); }
    } else {                                           // intervallo enorme e foglio quasi vuoto: scorro le celle esistenti
      for (const cell of this.cells.values()) if (cell.col >= g.c1 && cell.col <= g.c2 && cell.row >= g.r1 && cell.row <= g.r2) fn(cell);
    }
  }

  /**
   * Visita i VALORI dell'intervallo. Di default solo le celle esistenti (le vuote non cambiano somme/conteggi);
   * con ordered=true visita tutte le posizioni in ordine riga per riga (serve a CONCAT).
   * La cella che contiene la formula viene saltata se è dentro l'intervallo (es. E1 =SOMMA(A1:CV100)).
   */
  eachInRange(g, fn, ordered = false) {
    if (ordered) {
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const cell = this.cells.get(cellKey(c, r));
        fn(!cell || cell === this.cur ? null : this.readKey(cell.key), c, r);
      }
      return;
    }
    this.eachCell(g, (cell) => { if (cell !== this.cur) fn(this.readKey(cell.key), cell.col, cell.row); });
  }

  /** Raccoglie i numeri degli argomenti (intervalli o valori). skipErr=true: gli errori sono ignorati (CONTA). */
  nums(args, skipErr = false) {
    if (!args.length) return ERR.VALORE;
    const out = [];
    for (const a of args) {
      if (a.t === 'range') {
        const g = this.checkRange(a); if (g instanceof SheetError) return g;
        let err = null;
        this.eachInRange(g, (v) => {
          if (v instanceof SheetError) { if (!skipErr) err = err || v; } else if (typeof v === 'number') out.push(v);
        });
        if (err) return err;
      } else {
        const v = this.evalNode(a);
        if (v instanceof SheetError) { if (skipErr) continue; return v; }
        if (v === null) continue;
        if (a.t === 'ref') { if (typeof v === 'number') out.push(v); continue; } // testo/booleani nelle celle sono ignorati
        const x = toNum(v); if (x instanceof SheetError) { if (skipErr) continue; return x; }
        out.push(x);
      }
    }
    return out;
  }

  /** Argomenti di SOMMA.SE / CONTA.SE / MEDIA.SE → { range, crit, sumRange }. */
  condArgs(a) {
    if (a.length < 2 || a.length > 3) return ERR.VALORE;
    const range = this.checkRange(a[0]); if (range instanceof SheetError) return range;
    const cv = this.evalNode(a[1]); if (cv instanceof SheetError) return cv;
    let sumRange = range;
    if (a[2]) { sumRange = this.checkRange(a[2]); if (sumRange instanceof SheetError) return sumRange; }
    return { range, crit: makeCriterion(cv), sumRange };
  }

  /** Cella dell'intervallo-somma corrispondente (stessa posizione relativa) alla cella (col,row) dell'intervallo-criterio. */
  readOffset(c, col, row) {
    const sc = c.sumRange.c1 + (col - c.range.c1), sr = c.sumRange.r1 + (row - c.range.r1);
    return sc >= this.cols || sr >= this.rows ? null : this.readKey(cellKey(sc, sr));
  }

  /** Chiama fn(col,row,valore) per ogni cella dell'intervallo che soddisfa il criterio. */
  forMatching(g, crit, fn) {
    if (crit.test(null)) {                             // anche le celle vuote soddisfano il criterio → scansione per posizione
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const cell = this.cells.get(cellKey(c, r));
        const v = !cell || cell === this.cur ? null : this.readKey(cell.key);
        if (crit.test(v)) fn(c, r, v);
      }
    } else this.eachInRange(g, (v, c, r) => { if (crit.test(v)) fn(c, r, v); });
  }

  /* ── foglio intero: salvataggio/caricamento ── */

  /** Oggetto semplice serializzabile in JSON (solo contenuti grezzi). */
  serialize() {
    const cells = {};
    for (const c of this.cells.values()) cells[colToLabel(c.col) + (c.row + 1)] = c.raw;
    return { rows: this.rows, cols: this.cols, cells };
  }

  clear() {
    this.cells.clear(); this.dependents.clear(); this.colIndex.clear();
    this.rows = MIN_ROWS; this.cols = MIN_COLS;
  }

  load(data) {
    this.clear();
    this.rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, data.rows | 0 || MIN_ROWS));
    this.cols = Math.min(MAX_COLS, Math.max(MIN_COLS, data.cols | 0 || MIN_COLS));
    for (const [label, raw] of Object.entries(data.cells || {})) {
      const p = parseRef(label);
      if (!p || p.col >= this.cols || p.row >= this.rows || typeof raw !== 'string' || raw.trim() === '') continue;
      const key = cellKey(p.col, p.row);
      this.cells.set(key, this.makeCell(key, p.col, p.row, raw));
    }
    return this.recalcAll();
  }

  /* ── inserimento / eliminazione di righe e colonne ── */

  insertRows(at, n = 1) { return this.restructure('row', at, n); }
  deleteRows(at, n = 1) { return this.restructure('row', at, -n); }
  insertCols(at, n = 1) { return this.restructure('col', at, n); }
  deleteCols(at, n = 1) { return this.restructure('col', at, -n); }

  /**
   * delta > 0: inserisce `delta` righe/colonne prima di `at`; delta < 0: elimina -delta righe/colonne da `at`.
   * Le celle vengono spostate e le formule riscritte (shiftFormula); i riferimenti a celle eliminate diventano #RIF!.
   * La griglia non scende mai sotto 100×100. Restituisce false se si superano i limiti massimi.
   */
  restructure(axis, at, delta) {
    const dim = axis === 'row' ? 'rows' : 'cols';
    const min = axis === 'row' ? MIN_ROWS : MIN_COLS, max = axis === 'row' ? MAX_ROWS : MAX_COLS;
    if (delta > 0 && this[dim] + delta > max) return false;
    const old = [...this.cells.values()].map((c) => ({ col: c.col, row: c.row, raw: c.raw }));
    this.cells.clear(); this.dependents.clear(); this.colIndex.clear();
    this[dim] = Math.max(min, Math.min(max, this[dim] + delta));
    for (const o of old) {
      let pos = axis === 'row' ? o.row : o.col;
      if (delta > 0) { if (pos >= at) pos += delta; }
      else {
        const n = -delta;
        if (pos >= at && pos < at + n) continue;       // cella eliminata
        if (pos >= at + n) pos -= n;
      }
      const raw = o.raw[0] === '=' ? '=' + shiftFormula(o.raw.slice(1), axis, at, delta) : o.raw;
      const col = axis === 'col' ? pos : o.col, row = axis === 'row' ? pos : o.row;
      const key = cellKey(col, row);
      this.cells.set(key, this.makeCell(key, col, row, raw));
    }
    this.recalcAll();
    return true;
  }
}

/**
 * Riscrive i riferimenti di una formula dopo un inserimento/eliminazione di righe o colonne.
 * Le stringhe tra virgolette non vengono toccate; i nomi di funzione (seguiti da "(") nemmeno.
 */
export function shiftFormula(text, axis, at, delta) {
  const REF = /("(?:[^"]|"")*")|(?<![A-Za-z0-9_.])(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?(?![A-Za-z0-9_.(])/g;
  const split = (s) => { const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(s); return { ca: m[1], col: parseRef(s).col, ra: m[3], row: parseRef(s).row }; };
  const build = (p) => `${p.ca}${colToLabel(p.col)}${p.ra}${p.row + 1}`;
  const n = -delta;
  return text.replace(REF, (all, str, a, b) => {
    if (str) return str;
    const A = split(a);
    const get = (p) => (axis === 'row' ? p.row : p.col);
    const set = (p, v) => (axis === 'row' ? { ...p, row: v } : { ...p, col: v });
    if (!b) {                                          // riferimento singolo
      const x = get(A);
      if (delta > 0) return build(x >= at ? set(A, x + delta) : A);
      if (x >= at && x < at + n) return '#RIF!';       // la cella è stata eliminata
      return build(x >= at + n ? set(A, x - n) : A);
    }
    const B = split(b);                                // intervallo
    let s = get(A), e = get(B);
    if (s > e) [s, e] = [e, s];
    if (delta > 0) {
      s = s >= at ? s + delta : s; e = e >= at ? e + delta : e;
    } else if (e >= at) {
      if (s >= at + n) { s -= n; e -= n; }
      else { s = s < at ? s : at; e = e < at + n ? at - 1 : e - n; if (s > e) return '#RIF!'; }
    }
    return build(set(A, s)) + ':' + build(set(B, e));
  });
}

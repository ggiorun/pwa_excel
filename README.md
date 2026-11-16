# Mini-Foglio di Calcolo (PWA)

> ## 🔗 Sito pubblicato: **https://TUO-USERNAME.github.io/mini-sheet-pwa/**
> *(sostituisci `TUO-USERNAME` dopo il deploy; se hai usato anche Vercel aggiungi qui il secondo link: `https://mini-sheet-pwa.vercel.app`)*

Foglio di calcolo semplificato, installabile e funzionante offline: griglia **100 × 100** (A1:CV100) con rendering virtualizzato, motore di formule scritto da zero (nessuna libreria di spreadsheet), ricalcolo incrementale, rilevamento di errori e riferimenti circolari. JavaScript vanilla + Bootstrap 5 (solo CSS). Nessun dato viene inviato a server esterni.

## Avvio in locale

Il service worker richiede `http://localhost` (non `file://`):

```bash
cd mini-sheet-pwa
python3 -m http.server 8080        # oppure: npx serve .  /  Live Server di VS Code
# apri http://localhost:8080/
```

Test automatici del motore di calcolo (serve solo Node.js ≥ 18, nessuna installazione di pacchetti):

```bash
npm test          # = node tests/engine.test.mjs
```

## Deploy

**Piattaforma scelta: GitHub Pages** *(modifica questa sezione se usi Vercel o entrambe)*

1. Tutti i percorsi sono **relativi** (`./js/app.js`, `./sw.js`, `start_url: "./"`, `scope: "./"`): verificato anche servendo il sito da un sottopercorso (`/mini-sheet-pwa/`).
2. Crea un repository **pubblico** `mini-sheet-pwa` e carica i file:
   ```bash
   git init && git add . && git commit -m "Prima versione"
   git branch -M main
   git remote add origin https://github.com/TUO-USERNAME/mini-sheet-pwa.git
   git push -u origin main
   ```
3. Repository → **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. Dopo 1–2 minuti il sito è su `https://TUO-USERNAME.github.io/mini-sheet-pwa/`.
5. Verifica **in finestra anonima**: Console senza 404; DevTools → Application → Service Workers = *activated and running*; Manifest senza errori; icona "Installa" nella barra degli indirizzi; Network → *Offline* → ricarica → l'app si apre.

**Alternativa Vercel** (sito statico): Add New → Project → scegli il repo → Framework Preset *Other*, Build Command vuoto, Output Directory vuoto (root) → Deploy → `https://<nome>.vercel.app`. Ogni `git push` su `main` ripubblica in automatico.

> Dopo ogni modifica a file dell'app, incrementa `CACHE_VERSION` in `sw.js`, altrimenti i browser continuano a servire la copia vecchia dalla cache.

## Funzioni implementate

| Area | Cosa c'è |
|---|---|
| Griglia | 100 × 100 celle editabili (numeri, testo, formule con `=`), intestazioni A…CV e 1…100, evidenziazione di cella selezionata e di riga/colonna correnti, barra della formula con il contenuto grezzo, casella nome (digita `CV100` + Invio per saltarci) |
| Tastiera | Frecce, Tab / Maiusc+Tab, Invio / Maiusc+Invio (conferma e passa alla cella successiva), Esc, F2, Canc, Pag↑/Pag↓, Home, Ctrl+Home/Fine; digitando si inizia a modificare |
| Funzioni | `SOMMA`, `MEDIA`, `CONTA`, `CONTA.VALORI`, `SOMMA.SE`, `CONTA.SE`, `MEDIA.SE`, `MAX`, `MIN` |
| Parser | riferimenti `A1` / `$A$1`, intervalli `A1:B5` su più colonne (anche scritti al contrario), operatori `+ − * / ^`, parentesi e precedenze, numeri con `.` o `,`, stringhe `"..."` |
| Condizioni | `">5"`, `"<=3"`, `"<>x"`, `"=testo"`, numero secco, testo senza distinzione maiuscole/minuscole, jolly `*` e `?` |
| Errori | `#DIV/0!`, `#VALORE!`, `#RIF!`, `#NOME?`, `#CIRC!` (e `#NUM!`); passando il mouse su una cella o selezionandola, la barra di stato spiega l'errore |
| Ricalcolo | automatico, solo sulle celle dipendenti (vedi sotto) |
| PWA | `manifest.json` (nome, icone 192/512, `theme_color`, `display: standalone`), service worker con App Shell in cache, pulsante *Installa app*, indicatore Online/Offline |
| Responsive | Bootstrap 5; celle più alte su schermi touch; toolbar scorrevole; scroll orizzontale e verticale nativi; tocco su cella = seleziona, secondo tocco = modifica |

Separatore degli argomenti: `;` (es. `=SOMMA.SE(A1:A10;">5")`). Accettato anche `,` tra argomenti non numerici.

### Struttura

```
/mini-sheet-pwa
├── index.html            struttura della pagina
├── manifest.json
├── sw.js                 service worker (precache + cache-first con aggiornamento in background)
├── css/style.css         layout griglia, intestazioni sticky, responsive
├── js/app.js             UI, virtualizzazione, selezione/editing, toolbar, PWA
├── js/engine.js          tokenizer + parser + valutatore + grafo delle dipendenze
├── js/coordinates.js     conversione A1 ↔ indici
├── icons/                icon-192.png, icon-512.png
├── vendor/bootstrap.min.css   copia locale di Bootstrap 5.3.2 (licenza MIT)
├── tests/engine.test.mjs 37 test automatici
├── README.md
└── AI_LOG.md
```

## Strategia di virtualizzazione

**Virtualizzazione del DOM con scrollbar native.** Un contenitore (`#sizer`) ha le dimensioni dell'intero foglio, quindi barre di scorrimento, inerzia touch e scroll sono quelli veri del browser. Dentro vive solo la *finestra visibile*: ~30 righe × ~15 colonne più 3 righe/colonne di margine (≈ 430–480 `<div>` invece di 10.000). Ogni cella è un `div` con `left/top` assoluti calcolati **una sola volta** alla creazione; a ogni scroll (coalescato con `requestAnimationFrame`) si creano solo i `div` che entrano e si rimuovono quelli che escono, con un solo inserimento nel DOM tramite `DocumentFragment`. Le intestazioni A…CV / 1…100 usano `position: sticky` (restano visibili senza JavaScript); evidenziazione di riga/colonna e cella selezionata sono overlay mossi con `transform`, indipendenti dalle celle presenti. I click non hanno un listener per cella: la cella è calcolata dalle coordinate del puntatore.

**Alternative valutate.** (1) 10.000 `<td>` nel DOM: caricamento e scroll lenti su dispositivi di fascia media. (2) `content-visibility: auto`: semplice, ma il DOM resta enorme e non aiuta a creare i nodi. (3) `<canvas>`: velocissimo, ma accessibilità, editing in-cella e selezione testo vanno riscritti. (4) Scroll "finto" con trasformazioni e scrollbar custom: il compositor del browser non aiuta più e il touch scroll diventa fragile. Scelta: DOM virtualizzato con scroll nativo, il compromesso migliore tra fluidità, semplicità e usabilità su mobile.

## Dipendenze e ricalcolo (come si evitano ricalcoli inutili)

- Ogni formula, alla scrittura, viene analizzata una sola volta (AST in cache) e registra **cosa legge**: celle singole in `dependents[cella] = {formule}`; intervalli in un indice per colonna (`colIndex`). Così `=SOMMA(A1:CV100)` non crea 10.000 archi.
- Quando una cella cambia: si trovano (a catena) le sole formule che ne dipendono → si marcano *stale* → si valutano con memoizzazione (leggere una cella stale la calcola al volo: ogni cella è calcolata una volta sola, dopo le sue dipendenze).
- Una cella letta mentre è già in valutazione è un ciclo → `#CIRC!` (vale per `=C1` in C1 e per catene `A1→B1→A1`). Spezzando il ciclo, le celle tornano valide.
- Le funzioni scorrono solo le celle **non vuote** di un intervallo (se l'intervallo è più grande del foglio popolato, scorrono le celle esistenti): `=SOMMA(A1:CV100)` su griglia vuota costa zero.
- Il ricalcolo parte alla **conferma** (Invio/Tab/uscita dalla cella), non a ogni tasto, quindi digitare non ricalcola nulla; il salvataggio su `localStorage` è in debounce (400 ms). La barra di stato mostra *"Ricalcolate N formule in X ms"*.

## Casi di test

Eseguiti in questa sessione: motore con `npm test` (37 test, Node 22) e interfaccia con un test end-to-end in Chromium headless su `http://localhost` (anche da sottopercorso `/mini-sheet-pwa/`). **I punti 9 e 10 vanno completati sull'URL pubblico dopo il deploy.**

| # | Caso | Esito |
|---|---|---|
| 1 | A1=5, A2=10, A3==SOMMA(A1:A2) | ✅ mostra **15** |
| 2 | B1=0, B2==A1/B1 | ✅ mostra **#DIV/0!** |
| 3 | C1==C1 (e catena A1→B1→A1) | ✅ **#CIRC!** su tutte le celle del ciclo |
| 4 | D1==CONTA.SE(A1:A10;">5") con valori misti (3, 7, 12, "testo", 8, 1, 5, 10, 15) | ✅ **5** (anche SOMMA.SE = 52 e MEDIA.SE = 10,4) |
| 5 | E1==SOMMA(A1:CV100) su griglia vuota | ✅ **0**, nessun crash (vedi nota sotto) |
| 6 | Scorrimento riga 1 → 100 / colonna A → CV e ritorno | ✅ 122 passi (61 all'andata + 61 al ritorno, fino a riga 100 / colonna CV) in Chromium headless su desktop: frame sempre al passo del display (p50 16,7 ms, p95 16,8 ms, max 16,8 ms ≈ 60 fps); nel DOM restano ~430–480 celle. Da riprovare a mano su un telefono reale |
| 7 | Cella con 100 dipendenze (pulsante *Test 100 dipendenze*) | ✅ 100 formule ricalcolate in **≈ 0,1–0,2 ms** nel browser (≈ 3 ms nel test Node a freddo); limite 300 ms |
| 8 | Rete disattivata → ricarica | ✅ l'app si apre dalla cache e si può modificare (verificato con rete emulata offline, anche da sottopercorso) |
| 9 | URL pubblico in finestra anonima: app, installazione, offline | ⬜ **da verificare dopo il deploy** (in locale: nessun errore di installabilità secondo Chrome DevTools Protocol, manifest senza errori) |
| 10 | Nessun 404 in console sull'URL pubblico | ⬜ **da verificare dopo il deploy** (in locale e da sottopercorso: 0 richieste con errore, 0 messaggi in console) |

Altri numeri misurati: caricamento iniziale ≈ 140 ms in locale (headless, evento `load`); riempimento di 9.900 celle + 2 formule su tutto l'intervallo: modifica di una cella → 1 ms. **Lighthouse non è stato eseguito qui**: fallo dall'URL pubblico (DevTools → Lighthouse → *Progressive Web App*) e incolla il punteggio in questa tabella.

> **Nota sul caso 5.** La cella E1 si trova *dentro* A1:CV100. Excel in questo caso segnala un avviso di riferimento circolare; qui, per ottenere 0 come richiesto dal test, una formula che contiene sé stessa in un intervallo **ignora la propria cella** durante la somma. Un ciclo vero (es. B5 che legge E1 mentre E1 somma A1:CV100) resta segnalato come `#CIRC!`.

## Funzionalità extra (bonus)

- `SE`, `CONCAT`, `ARROTONDA`, operatore `&`, confronti, `VERO`/`FALSO`, alias inglesi (`SUM`, `IF`, `COUNTIF`…)
- Salvataggio automatico su `localStorage`
- Esportazione **CSV** (valori calcolati, separatore `;`, UTF-8 con BOM)
- **Inserimento/eliminazione di righe e colonne** con riscrittura delle formule (i riferimenti a celle eliminate diventano `#RIF!`, gli intervalli si adattano); la griglia non scende mai sotto 100×100 e arriva al massimo a 1000×702
- Esempi precaricabili (*Esempi*) e test delle 100 dipendenze con misura del tempo (*Test 100 dipendenze*)
- 37 test automatici (`npm test`)
- ⬜ Doppio deploy GitHub Pages + Vercel: da fare se vuoi il bonus

## Note tecniche e scelte

- **Bootstrap in locale.** `vendor/bootstrap.min.css` è Bootstrap **5.3.2** (MIT) in una build tema "Cerulean" di Bootswatch: l'ambiente di sviluppo non aveva accesso a internet per scaricare la build ufficiale. Si usano solo componenti neutri (bottoni, campi, badge, utility); se preferisci la build ufficiale, sostituisci il file (stesso nome) e incrementa `CACHE_VERSION`. Tenerlo in locale evita richieste a server esterni e permette l'uso offline.
- **Errore circolare esteso.** Le celle che dipendono da una cella circolare mostrano anch'esse `#CIRC!` (l'errore si propaga come qualunque altro).
- **Celle vuote.** `=A1` con A1 vuota vale 0; `CONTA.SE(…;"<>x")` conta anche le celle vuote (come Excel).
- **Limiti noti.** Nessun annulla/ripeti, copia/incolla di intervalli, selezione multipla, né riferimenti ad altri fogli.

## Difficoltà incontrate e come risolte

*(Da completare con la vostra esperienza reale; qui i punti tecnici emersi durante lo sviluppo.)*

- **Test 5 (E1 dentro il proprio intervallo):** letteralmente è un riferimento circolare. Soluzione: la cella-formula viene saltata quando scorre un intervallo che la contiene (vedi nota).
- **Intestazioni con virtualizzazione:** invece di sincronizzarle via JavaScript allo scroll (ritardo di un frame), si usano `position: sticky` con intestazioni virtualizzate a loro volta.
- **Dipendenze su intervalli grandi:** un arco per cella avrebbe dato 10.000 archi per `A1:CV100`; risolto con l'indice per colonna.
- **Deploy / percorsi / scope / cache:** ⬜ *(descrivete qui i problemi reali incontrati su GitHub Pages o Vercel)*

## Domande di riflessione

1. **Quale parte del codice hai scritto tu e quale è stata generata dall'AI? Come hai verificato la correttezza?**
   ⬜ *Da compilare a cura degli studenti.* Nota di trasparenza: il codice di questa versione è stato generato da Claude in un'unica sessione a partire dal testo della prova; la verifica automatica è descritta in "Casi di test". Indicate cosa avete letto, capito, modificato e testato voi.
2. **Quali prompt sono stati più efficaci? Perché?** ⬜ *Da compilare (vedi `AI_LOG.md`).*
3. **Cosa ha fatto l'AI che hai dovuto correggere? Perché?** ⬜ *Da compilare.*
4. **Quale strategia di virtualizzazione hai scelto e perché? Quali alternative hai valutato?** → vedi sezione *Strategia di virtualizzazione* (DOM virtualizzato con scroll nativo; scartati: 10.000 `<td>`, `content-visibility`, canvas, scroll simulato).
5. **Come hai gestito le dipendenze tra celle per evitare ricalcoli inutili su 10.000 celle?** → vedi sezione *Dipendenze e ricalcolo* (grafo inverso per celle singole, indice per colonna per gli intervalli, ricalcolo solo delle celle dipendenti con memoizzazione, scansione solo delle celle non vuote).
6. **Quale piattaforma hai scelto per il deploy e perché? Quali problemi hai incontrato (percorsi, scope del service worker, cache, HTTPS)?** ⬜ *Da compilare dopo il deploy.*
7. **Come hai verificato che la PWA funzioni dall'URL pubblico e non solo in locale?** ⬜ *Da compilare. Procedura: finestra anonima → Console senza 404 → Application → Service Workers "activated" → Manifest senza errori → installazione → Network "Offline" + ricarica → Lighthouse.*
8. **Cosa cambieresti se dovessi rifare la prova?** ⬜ *Da compilare.*

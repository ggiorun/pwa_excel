# Mini-Foglio di Calcolo (PWA)

## 🔗 Sito pubblicato: **DA INSERIRE DOPO IL DEPLOY** → `https://TUO-USERNAME.github.io/mini-sheet-pwa/` (oppure `https://mini-sheet-pwa.vercel.app`)

Foglio di calcolo 100×100 (A1:CV100) con motore di formule scritto da zero, installabile come app e utilizzabile offline. HTML + CSS + JavaScript vanilla (moduli ES), Bootstrap 5.3.3 servito **in locale** da `vendor/` (nessuna richiesta a server esterni, così funziona anche offline).

## Avvio in locale

Il service worker richiede un server, non funziona da `file://`:

```bash
cd mini-sheet-pwa
python3 -m http.server 8080      # oppure: npx serve .  /  Live Server di VS Code
# apri http://localhost:8080/
```

Test automatici del motore: `node tests/engine.test.mjs` (Node ≥ 18).

## Deploy

Il progetto è un sito statico: nessuna build. Tutti i percorsi sono relativi (`./js/app.js`, `./sw.js`; nel manifest `start_url: "./"`, `scope: "./"`).

**GitHub Pages** (piattaforma scelta: _[completare: GitHub Pages / Vercel / entrambe]_)
1. Crea il repository pubblico `mini-sheet-pwa` e carica i file: `git init && git add . && git commit -m "Prima versione" && git branch -M main && git remote add origin https://github.com/TUO-USERNAME/mini-sheet-pwa.git && git push -u origin main`
2. Repository → *Settings → Pages* → *Deploy from a branch* → branch `main`, cartella `/ (root)` → *Save*.
3. Dopo 1–2 minuti l'app è su `https://TUO-USERNAME.github.io/mini-sheet-pwa/`.

**Vercel** (opzionale, +bonus): *Add New → Project* → importa il repo → Framework Preset **Other**, Build Command e Output Directory vuoti → *Deploy*.

Verifica finale dall'URL pubblico in finestra anonima: DevTools → *Application* → Service Workers (*activated and running*), Manifest senza errori, poi *Network → Offline* e ricarica.

## Funzioni implementate

| Funzione | Esempio |
|---|---|
| SOMMA, MEDIA, MAX, MIN | `=SOMMA(A1:A5)` |
| CONTA (celle numeriche), CONTA.VALORI (non vuote) | `=CONTA.VALORI(A1:A5)` |
| SOMMA.SE, CONTA.SE, MEDIA.SE (anche con terzo argomento = intervallo somma) | `=SOMMA.SE(A1:A10;">5")` |
| Extra: SE, CONCAT, ARROTONDA | `=SE(A1>5;"alto";"basso")` |

- Riferimenti singoli (`A1`, anche `$A$1`) e intervalli su più righe/colonne (`A1:B5`).
- Operatori `+ - * / ^`, meno unario, parentesi, confronti `= <> < > <= >=`. Separatore argomenti `;` (anche `,`); decimali con il punto nelle formule.
- Criteri: `">5"`, `"<=3"`, `"<>0"`, `"=ciao"`, `"ciao"` (testo senza distinzione maiuscole/minuscole).
- Errori: `#DIV/0!`, `#VALORE!`, `#RIF!` (cella fuori griglia), `#NOME?` (funzione/nome sconosciuto), `#CIRC!` (riferimento circolare). Gli errori si propagano alle celle dipendenti; passando il mouse su un errore si vede la spiegazione.
- Interfaccia: intestazioni A…CV e 1…100, barra della formula (contenuto grezzo, modificabile), evidenziazione cella/riga/colonna correnti, frecce, Tab/Maiusc+Tab, Invio (conferma e scende), F2/doppio clic per modificare, digitare sovrascrive, Canc svuota, Pag↑/Pag↓, Home/Ctrl+Home. Su touch: tap per selezionare, secondo tap per modificare, oppure usare la barra della formula.

**Scelta di progetto:** un intervallo che contiene la cella della formula ignora quella cella. Per questo `E1 = SOMMA(A1:CV100)` dà `0` su griglia vuota (caso di test 5) invece di `#CIRC!`. I cicli veri (`A1→B1→A1`, `=C1` in C1) sono segnalati.

## Strategia di virtualizzazione

Il DOM contiene solo le celle visibili (~30×15 + 2 righe/colonne di margine, poche centinaia di elementi invece di 10.000). Un contenitore `#space` ha la dimensione totale della griglia, quindi la barra di scorrimento nativa rappresenta tutte le 100×100 celle; a ogni `scroll` (al massimo uno per frame, con `requestAnimationFrame`) si calcola dalla posizione di scorrimento quali righe/colonne sono visibili e si ridisegna solo se la finestra è cambiata. Le intestazioni stanno fuori dall'area scorrevole e vengono solo traslate con `transform`. Alternative valutate: `content-visibility: auto` (lascia comunque 10.000 nodi nel DOM) e un pool di nodi riciclati (più veloce ma più complesso: con poche centinaia di celle `innerHTML` basta).

## Dipendenze e ricalcolo

Per ogni formula si salvano le celle e gli intervalli letti. Quando una cella cambia si visita il grafo **inverso** (chi usa questa cella, anche indirettamente) e si ricalcolano solo quelle; i valori sono in cache e la valutazione ricorsiva rispetta l'ordine. Le celle vuote di un intervallo non vengono calcolate. I cicli si rilevano segnando le celle "in valutazione". La barra di stato mostra quante celle sono state ricalcolate e in quanti ms.

## Casi di test

Test eseguiti con `node tests/engine.test.mjs` (37 verifiche, tutte superate) e con un controllo dell'interfaccia in jsdom. I punti di sola verifica manuale nel browser vanno completati da voi.

| # | Caso | Esito |
|---|---|---|
| 1 | A1=5, A2=10, A3=`=SOMMA(A1:A2)` | ✅ 15 (test automatico) |
| 2 | B1=0, B2=`=A1/B1` | ✅ `#DIV/0!` |
| 3 | C1=`=C1` (e catena A1→B1→A1) | ✅ `#CIRC!` |
| 4 | D1=`=CONTA.SE(A1:A10;">5")`, valori misti | ✅ 3 |
| 5 | E1=`=SOMMA(A1:CV100)` su griglia vuota | ✅ 0, nessun crash |
| 6 | Scorrimento riga 1→100 e ritorno | ⬜ da verificare nel browser |
| 7 | Modifica cella con 100 dipendenze | ✅ motore: 101 celle in ~11 ms (Node); ⬜ confermare nel browser con il pulsante *Test 100 dipendenze* |
| 8 | Rete disattivata → ricarica offline | ⬜ da verificare dopo il deploy |
| 9 | URL pubblico in finestra anonima, installazione, offline | ⬜ da verificare dopo il deploy |
| 10 | Nessun 404 in console sull'URL pubblico | ⬜ da verificare dopo il deploy |

## Funzionalità extra

SE, CONCAT, ARROTONDA; salvataggio automatico in `localStorage`; esportazione CSV (separatore `;`); pulsanti *Esempi* e *Test 100 dipendenze*; indicatore online/offline; pulsante *Installa app*; Bootstrap servito localmente. Non implementato: inserimento/eliminazione di righe e colonne.

## Difficoltà incontrate e come risolte

- **Test 5 vs riferimenti circolari:** `E1` è dentro `A1:CV100`, quindi alla lettera sarebbe circolare. Soluzione: l'intervallo ignora la cella della formula (vedi *Scelta di progetto*).
- **Bootstrap offline:** la versione da CDN non funziona offline e viola «nessun dato a server esterni»; è stato scaricato in `vendor/` e il commento `sourceMappingURL` è stato rimosso per evitare un 404 nella console.
- **Dimensioni celle su smartphone:** cambiano con una media query, quindi `app.js` le legge dalle variabili CSS invece di duplicarle.
- _[aggiungere le difficoltà reali che incontrate nel deploy]_

## Domande di riflessione

1. **Codice scritto da voi / dall'AI e verifica.** Il codice di questa versione è stato generato da Claude (Anthropic) a partire dalla traccia. Verifica: 37 test automatici del motore, smoke test dell'interfaccia, prove manuali. _[Completare: cosa avete scritto, letto e modificato voi.]_
2. **Prompt più efficaci.** _[Da completare con i vostri prompt: vedi AI_LOG.md.]_
3. **Cosa ha sbagliato l'AI.** Durante lo sviluppo: aspettative di test errate (`-2^2`, decimali con la virgola nelle formule) e un test che scriveva fuori griglia, scoperti eseguendo i test. _[Aggiungere eventuali altri casi.]_
4. **Virtualizzazione.** Vedi sezione dedicata (finestra visibile calcolata dallo scroll, nativa e senza librerie).
5. **Dipendenze.** Vedi *Dipendenze e ricalcolo*: grafo inverso, solo le celle toccate, cache, celle vuote saltate.
6. **Piattaforma e problemi di deploy.** _[Da completare dopo il deploy: percorsi, scope, cache, HTTPS.]_
7. **Verifica dall'URL pubblico.** _[Da completare: finestra anonima, Application → Service Workers, Network → Offline, Lighthouse.]_
8. **Cosa cambiereste.** _[Da completare.]_

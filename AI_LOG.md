# AI_LOG — uso dell'AI nel progetto

**Strumento:** Claude (Anthropic), chat web.
**Regola di questo file:** ogni voce deve descrivere ciò che è *realmente* successo. La consegna richiede almeno 5 prompt, di cui uno sul deploy/pubblicazione.

## Stato del registro

| Voce | Stato |
|---|---|
| 1. Generazione del progetto dal testo della prova | ✅ **Avvenuta** (descritta sotto) |
| 2. Virtualizzazione | ⬜ da eseguire e compilare |
| 3. Struttura del parser | ⬜ da eseguire e compilare |
| 4. Dipendenze e riferimenti circolari | ⬜ da eseguire e compilare |
| 5. Deploy / service worker / percorsi (**obbligatoria**) | ⬜ da eseguire e compilare |

Le voci 2–5 contengono un prompt **suggerito**: usatelo (o adattatelo) davvero in una nuova conversazione, incollando il vostro codice o l'errore che vedete, poi riportate qui la risposta sintetizzata e cosa avete cambiato voi. Come dice la traccia: usate l'AI *per farvi spiegare*, non per farvi fare tutto.

---

## Voce 1 — Generazione dell'intero progetto  ✅

**Prompt (reale):**
> Allegato: il PDF della prova pratica «Creazione di una PWA Mini-Foglio di Calcolo con supporto AI».
> «segui alla lettera la guida del pdf ed esegui ciò che è richiesto»

**Risposta ottenuta (sintesi):** Claude ha prodotto l'intero repository: `index.html`, `manifest.json`, `sw.js`, `css/style.css`, `js/app.js` (UI e virtualizzazione), `js/engine.js` (tokenizer, parser a discesa ricorsiva, valutatore, grafo delle dipendenze, ricalcolo incrementale), `js/coordinates.js`, icone 192/512, una suite di 37 test Node (`tests/engine.test.mjs`), `README.md` e questo file. Ha poi verificato il lavoro in un Chromium headless: tastiera, scorrimento fino a CV100, test con 100 dipendenze, installabilità, offline e prova da sottopercorso `/mini-sheet-pwa/` (come GitHub Pages).

**Cosa Claude ha deciso in autonomia (da conoscere e saper spiegare in demo):**
- ricalcolo *pigro con memoizzazione* + stato `STALE/BUSY` per rilevare i cicli (`#CIRC!`);
- intervalli indicizzati per colonna (nessun arco per cella);
- caso di test 5: la cella che contiene `=SOMMA(A1:CV100)` si trova dentro l'intervallo; per mostrare 0 come richiesto, la propria cella viene ignorata (Excel segnalerebbe un avviso circolare);
- Bootstrap 5.3.2 salvato in locale (`vendor/`), perché l'ambiente non aveva accesso a internet; è una build tema "Cerulean" di Bootswatch;
- limiti noti: niente annulla/ripeti, copia/incolla di intervalli, selezione multipla.

**Cosa ho modificato/adattato manualmente:**
⬜ *(da compilare: cosa avete letto, cambiato, rifiutato o riscritto — es. nomi, commenti, stili, funzioni extra; e come avete verificato che funzioni)*

**Riflessione:** ⬜ *(da compilare: cosa avete capito e cosa invece fate fatica a spiegare)*

---

## Voce 2 — Virtualizzazione  ⬜

**Prompt suggerito:**
> Sto costruendo una griglia 100×100 in JavaScript vanilla. Perché non posso creare 10.000 `<div>`? Spiegami come funziona la virtualizzazione e quali alternative ci sono (content-visibility, canvas, scroll simulato), con pro e contro per uno schermo mobile. Non scrivermi il codice completo.

**Risposta ottenuta (sintesi):** ⬜
**Cosa ho modificato/adattato manualmente:** ⬜ *(es. numero di righe di overscan, come avete misurato lo scorrimento)*

---

## Voce 3 — Struttura del parser di formule  ⬜

**Prompt suggerito:**
> Come si struttura un parser di formule tipo `=SOMMA(A1:A5)+B2*2`? Spiegami tokenizer, grammatica con precedenza degli operatori e AST, poi come si valuta l'AST. Fammi un esempio con `=2+3*4` e `=(2+3)*4`.

**Risposta ottenuta (sintesi):** ⬜
**Cosa ho modificato/adattato manualmente:** ⬜ *(es. gestione di `;` come separatore, errori `#NOME?`)*

---

## Voce 4 — Dipendenze, ricalcolo e riferimenti circolari  ⬜

**Prompt suggerito:**
> Ho un foglio con 10.000 celle e formule che leggono altre celle e intervalli. Come evito di ricalcolare tutto a ogni modifica? Spiegami grafo delle dipendenze, ricalcolo incrementale e come si rileva un riferimento circolare (A1→B1→A1), con i compromessi per gli intervalli grandi come `A1:CV100`.

**Risposta ottenuta (sintesi):** ⬜
**Cosa ho modificato/adattato manualmente:** ⬜

---

## Voce 5 — Problema di deploy / service worker (obbligatoria)  ⬜

**Prompt suggerito (da adattare con il vostro errore reale):**
> Ho pubblicato la mia PWA su GitHub Pages all'indirizzo `https://<utente>.github.io/mini-sheet-pwa/` ma [descrivete il sintomo: 404 su `sw.js`, il service worker non risulta "activated", l'icona Installa non compare, offline mostra il dinosauro…]. Questo è il mio `manifest.json`, il punto in cui registro il service worker e la lista `PRECACHE` di `sw.js`: [incollate il codice]. Qual è la causa più probabile (percorsi relativi/assoluti, scope, cache vecchia, HTTPS) e come la verifico dalla DevTools?

**Risposta ottenuta (sintesi):** ⬜
**Cosa ho modificato/adattato manualmente:** ⬜ *(es. percorso di registrazione, `CACHE_VERSION`, hard reload / "Unregister")*
**Come ho verificato la soluzione sull'URL pubblico:** ⬜ *(finestra anonima, Application → Service Workers, Network → Offline)*

---

## Verifiche eseguite durante la generazione (fatti, non prompt)

- `node tests/engine.test.mjs` → 37 test superati (casi 1–5 e 7 della prova, funzioni condizionali, errori, circolarità, ricalcolo incrementale, inserimento/eliminazione righe e colonne, salvataggio).
- Chromium headless su `http://localhost`: nessun errore in console, nessuna risposta HTTP ≥ 400, service worker *activated* con scope corretto, nessun errore di installabilità (CDP `Page.getInstallabilityErrors`), ricarica offline riuscita, scorrimento fino a riga 100 / colonna CV a ~60 fps, nessun overflow orizzontale della pagina a 390 px.
- **Non eseguiti** (richiedono voi): pubblicazione su GitHub Pages/Vercel, test dall'URL pubblico in finestra anonima, Lighthouse, prova su dispositivo reale, registrazione della demo.

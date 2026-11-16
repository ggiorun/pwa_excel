# AI_LOG — uso dell'AI nel progetto

> **Importante:** la consegna richiede **almeno 5 prompt reali**, di cui uno sul deploy. Qui è registrato con precisione solo quello che è successo davvero (prompt n. 1). I prompt 2–5 sono **da compilare voi** dopo averli usati: sotto trovate i temi suggeriti. Non inserite prompt che non avete eseguito.

## Prompt 1 — Generazione dell'intero scheletro del progetto (già eseguito)
- **Strumento:** Claude (Anthropic), chat.
- **Prompt:** allegato il PDF della prova, richiesta: «esegui le istruzioni contenute nel pdf ed esegui alla lettera le istruzioni».
- **Risposta (sintesi):** Claude ha creato la struttura richiesta (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/app.js`, `js/engine.js`, `js/coordinates.js`, icone, README, AI_LOG, test). Ha scritto il parser a discesa ricorsiva (tokenizer → AST → valutatore), il grafo delle dipendenze inverse con ricalcolo incrementale, il rilevamento dei cicli, la griglia virtualizzata e il service worker *cache-first*. Ha scaricato Bootstrap in locale e verificato il motore con test automatici.
- **Cosa è stato modificato/adattato manualmente:** _[da compilare: cosa avete letto, cambiato o corretto voi]_
- **Riflessione:** non ha potuto pubblicare il sito (servono il vostro account GitHub/Vercel) né provare l'app in un vero browser: il comportamento di scorrimento, installazione e offline va verificato da voi.

## Prompt 2 — Spiegazione del parser _(da compilare)_
Tema suggerito: «Come si struttura un parser di formule con precedenza degli operatori? Spiegami la grammatica usata in `engine.js`.» — annotate cosa avete capito e cosa avete cambiato.

## Prompt 3 — Virtualizzazione e prestazioni _(da compilare)_
Tema suggerito: «Spiegami come funziona il calcolo della finestra visibile in `render()` e come misurare la fluidità dello scroll.»

## Prompt 4 — Refactoring o correzione di un errore _(da compilare)_
Tema suggerito: un bug reale che trovate provando l'app (es. una formula che non si comporta come atteso), con il prompt, la risposta e la correzione applicata.

## Prompt 5 — Problema di deploy/pubblicazione _(da compilare, obbligatorio)_
Tema suggerito: un errore reale nel deploy (404 su `sw.js`, service worker non attivato, cache vecchia, scope). Riportate l'errore esatto della console, il prompt, la soluzione e come avete verificato in finestra anonima.

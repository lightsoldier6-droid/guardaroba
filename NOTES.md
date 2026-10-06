# Note di progetto

## Architettura in una riga
iPhone (PWA statica su GitHub Pages) ⇄ Supabase (Auth, Postgres con RLS, Storage privato) — e solo per l’AI: PWA → Edge Function `ai` → Ollama Cloud. Il meteo arriva direttamente da Open-Meteo, senza chiave.

```
Safari/PWA ──(token utente)──▶ Supabase REST/Storage   (dati e foto, filtrati dalla RLS)
          └─(token utente)──▶ Edge Function "ai" ──(OLLAMA_API_KEY, secret)──▶ ollama.com/api/chat
          └────────────────▶ api.open-meteo.com      (nessuna chiave)
```

## Scelte fatte
- **Nessun framework né build**: HTML, CSS e moduli JavaScript caricati così come sono. Si modifica anche dalla pagina web di GitHub. La libreria `supabase-js` (v2.117.2) è inclusa in `vendor/` per funzionare offline e non dipendere da una CDN.
- **Prima la cache locale**: l’app legge sempre da IndexedDB e accoda le modifiche (outbox) per inviarle appena c’è rete. Gli identificativi sono UUID generati sul telefono, quindi si possono creare capi anche offline.
- **AI solo dove serve**: l’AI legge le foto (capo, etichetta, guida taglie). Outfit, punteggio d’acquisto e taglie sono calcolati sul telefono con regole trasparenti: risposte istantanee, gratis, funzionanti anche senza rete, e spiegabili.
- **Output AI vincolato**: la Edge Function passa a Ollama uno schema JSON (`format`) con i soli codici ammessi; l’app scarta comunque qualunque valore fuori vocabolario e tu confermi ogni campo prima del salvataggio (i campi letti sono marcati “letto”).
- **Due modelli in cascata**: `gemma4:31b`, poi `glm-5.3-flash` se il primo fallisce o viene ritirato. Modificabile con il secret `OLLAMA_VISION_MODELS`, senza toccare il codice.
- **Foto**: compresse in JPEG sul telefono prima dell’invio (archivio 1600 px, miniatura 480 px per le griglie, 1280 px per l’AI). Ogni sostituzione crea un nuovo file e cancella il vecchio, così le cache non mostrano mai foto superate.
- **Accesso**: email e password su un unico utente creato a mano, iscrizioni chiuse. Il link magico via email è stato escluso perché su iPhone si aprirebbe in Safari e non nell’app installata.
- **Sicurezza della chiave AI**: la chiave Ollama esiste solo come secret della Edge Function; il frontend non contiene né l’indirizzo né la chiave di Ollama. La funzione accetta solo JWT validi di Supabase (`@supabase/server`) e, con `ALLOWED_USER_ID`, solo il tuo utente. `tools/check-secrets.sh` controlla il repository prima della pubblicazione.

## Modello dati (riusabile da un’app nativa senza migrazioni)
| Tabella | Contenuto | Note |
|---|---|---|
| `items` | capi e calzature | codici stabili in inglese per categoria (`shirt`, `blazer`…), colori (`navy`…), stagioni (`spring`…), occasioni (`formal`, `work`, `casual`, `sport`), “come ti veste” (`tight`, `right`, `loose`), sistema taglie (`IT`, `EU`, `UK`, `US`, `LETTER`). `composition` è JSON `[{fiber,pct}]`, `size_alt` le altre taglie lette in etichetta; `fabric` il tessuto prevalente (`cotton`, `linen`, `wool`, `cashmere`, `silk`, `leather`, `suede`…), ricavato dalla composizione e modificabile |
| `wear_log` | un capo indossato in un giorno | univoco per (capo, giorno); `outfit_id` raggruppa i capi indossati insieme |
| `measurements` | una riga per giorno di aggiornamento | lo storico è la tabella stessa; l’ultima riga è la misura attuale |

Foto nel bucket privato `wardrobe`: `<user_id>/<item_id>/photo-<timestamp>.jpg`, `thumb-…`, `label-…`; il percorso è salvato nella riga del capo.
Le etichette italiane e le regole (slot nell’outfit, peso, durata stimata) stanno in `js/taxonomy.js`: aggiungere una categoria non richiede modifiche al database. Va aggiunta anche all’elenco in `supabase/functions/ai/index.ts`.

## Come ragiona l’app
- **Outfit del giorno** (`js/outfit.js`): filtra per occasione e meteo (niente shorts sotto i 19°, niente cappotto sopra i 18°…), dà a ogni capo un punteggio di rotazione (penalizzato se indossato negli ultimi 3 giorni, premiato se fermo da settimane) e di stagione, poi combina sopra/sotto/scarpe con strati facoltativi e sceglie le 3 combinazioni migliori e diverse tra loro. Pesi: 40% capi (rotazione e stagione), 30% armonia dei colori, 30% calore adatto alla temperatura percepita, più correzioni per pioggia e vento.
- **Tessuto**: se non hai indicato il peso, il lino alleggerisce e lana o cashmere appesantiscono il capo; il lino è escluso sotto i 15° percepiti, lana e cashmere sopra i 26°; scarpe scamosciate o in tela sono penalizzate con la pioggia. In negozio, stesso capo e colore ma tessuto diverso conta come simile, non come doppione.
- **Armonia dei colori**: neutri (nero, grigi, blu navy, beige, marrone, azzurro, denim…) liberi; al massimo un colore d’accento è l’ideale, due funzionano se vicini, complementari o di luminosità molto diversa; penalità per nero con blu navy e per scarpe marroni con pantaloni neri.
- **Punteggio in negozio** (`js/shopping.js`): 35% outfit nuovi validi che il capo sblocca con ciò che hai (combinazioni sopra/sotto/scarpe, più giacca per il formale, con armonia sufficiente), 30% bisogno (vuoti stagione×occasione meno doppioni), 15% copertura di stagioni e occasioni, 20% costo per utilizzo. Verdetto: ≥68 compralo, 45–67 valuta, sotto lascia perdere; un doppione senza vuoti da riempire non supera 55.
- **Taglie** (`js/sizes.js`): la taglia “ideale” di ogni capo è quella indossata corretta di uno scalino se ti va stretta o larga. Ordine delle fonti per la taglia da provare: storico della stessa marca → guida taglie fotografata → tua taglia abituale su altre marche → stima dalle misure. L’affidabilità sale quando due fonti indipendenti concordano.

## Limiti noti
**iOS e PWA**
- L’app installata ha memoria separata da Safari: l’accesso va fatto dall’icona. Se rimuovi l’icona, la cache locale si perde (i dati restano su Supabase).
- Nessuna sincronizzazione in background: le modifiche in coda partono quando l’app è aperta (all’avvio, al ritorno della rete, ogni minuto). Non chiudere l’app subito dopo un salvataggio offline se ti serve vederlo su un altro dispositivo.
- La fotocamera passa dal selettore standard di iOS (scatta o scegli dalla libreria), non da un mirino integrato.
- iOS può cancellare i dati locali dei siti poco usati; le app aggiunte alla Home ne sono in larga parte escluse e l’app chiede comunque l’archiviazione persistente. In ogni caso il server resta la copia completa.
- I caratteri tipografici arrivano da Google Fonts al primo avvio con rete; offline prima di allora si vede il carattere di sistema.
- Dopo un aggiornamento del codice serve una riapertura (o due) perché il service worker installi la nuova versione.

**Taglie**
- Le conversioni tra sistemi (IT/EU/UK/US/lettere) usano tabelle standard da uomo: le marche se ne discostano spesso di una taglia, soprattutto nei pantaloni in pollici (vanity sizing) e nelle scarpe (mezzi numeri). Per questo la tabella distingue i valori **osservati** sui tuoi capi (grassetto) da quelli **stimati** dalle misure, e la taglia consigliata dichiara l’affidabilità.
- La lettura delle guide taglie dipende dalla foto: tabelle storte, riflessi o colonne in pollici e centimetri insieme possono confondere il modello.

**AI**
- Simboli di lavaggio piccoli o consumati vengono letti male più spesso del testo; i colori dalle foto in negozio risentono della luce. Per questo ogni campo resta modificabile.
- Il nome e la disponibilità dei modelli cloud di Ollama cambiano nel tempo: se un modello viene ritirato basta aggiornare `OLLAMA_VISION_MODELS`.

**Euristiche**
- Costo per utilizzo e utilizzi annui sono stime: quando il registro “indossato” copre almeno 30 giorni l’app usa i tuoi dati reali per quel ruolo, prima di allora una stima per occasione e stagione.
- Fantasie (righe, quadri) non sono considerate nell’armonia: l’app ragiona solo su colori dominanti e secondari.

## Cosa è stato verificato e cosa no
Verificato in questa sessione:
- Schema SQL eseguito due volte su PostgreSQL 16 con funzioni `auth`/`storage` simulate: isolamento tra due utenti su tutte le tabelle e sullo storage, rifiuto degli anonimi, vincoli sui codici.
- Edge Function: type-check con Deno 2.9 e prova con JWT firmati e Ollama simulato (401 senza token o con token falsificato, preflight CORS, 403 con utente diverso da `ALLOWED_USER_ID`, passaggio al secondo modello se il primo risponde 404, nessuna chiave negli errori).
- Interfaccia in Chromium headless a dimensione iPhone, con Supabase e AI simulati: accesso, catalogo con lettura etichetta, scheda capo, outfit del giorno e “indossato oggi”, misure e tabella taglie, modalità negozio fino a “L’ho comprato”, coda offline e invio al ritorno della rete, riavvio completamente offline dal service worker, tema scuro.

Non verificato (richiede i tuoi account o il tuo telefono):
- Chiamate reali a Supabase e a Ollama Cloud: qualità della lettura delle etichette e tempi di risposta dei modelli.
- Safari su iPhone reale (installazione sulla Home, fotocamera, geolocalizzazione, comportamento della cache).
- I nomi esatti delle voci di menu nelle dashboard di Supabase e GitHub, che cambiano periodicamente.

## Verso un’app nativa SwiftUI
1. **Stesso backend, nessuna migrazione**: usa `supabase-swift` con lo stesso URL e la stessa chiave pubblicabile; tabelle, RLS, bucket e Edge Function restano identici. I codici in inglese diventano `enum` Swift con `rawValue` uguale.
2. **Porta le tre logiche pure** (`outfit.js`, `sizes.js`, `shopping.js`) in Swift come funzioni senza effetti collaterali, e trasforma i casi di prova di questa sessione in test XCTest per garantire risultati identici tra le due app.
3. **Offline**: SwiftData come cache locale con la stessa semantica di outbox (UUID generati dal client, operazioni in ordine, ritentativi). In più, `BGAppRefreshTask` per inviare le modifiche anche ad app chiusa.
4. **Fotocamera e etichette**: `VisionKit` (`DataScannerViewController`) può leggere sul telefono il testo dell’etichetta e mandare all’AI solo i casi dubbi, riducendo tempi e costi.
5. **Accesso**: aggiungi Sign in with Apple accanto all’utente email esistente; i dati, legati all’id utente, restano gli stessi.
6. Durante la transizione PWA e app nativa possono convivere sullo stesso account.

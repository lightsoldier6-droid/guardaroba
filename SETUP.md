# Mettere online Guardaroba — istruzioni passo-passo

Tempo stimato: 40 minuti. Servono un computer, l’iPhone e tre account: **Supabase**, **GitHub**, **Ollama**.
Non serve installare niente sul computer: si fa tutto dal browser.

Regola d’oro per tutta la procedura: **la chiave Ollama si incolla in un solo posto, i Secrets di Supabase (passo 6)**. Mai in un file, mai in chat, mai su GitHub.

---

## Parte A — Supabase (database, foto, accesso, AI)

### 1. Crea il progetto
1. Vai su [supabase.com/dashboard](https://supabase.com/dashboard) e accedi.
2. **New project**. Nome: `guardaroba`. Regione: **Central EU (Frankfurt)**, la più vicina all’Italia.
3. Inventa una password del database e salvala nel tuo gestore di password (all’app non serve, ma a te sì in caso di assistenza).
4. Attendi un paio di minuti che il progetto sia pronto.

### 2. Crea le tabelle e lo spazio per le foto
1. Nel menu a sinistra apri **SQL Editor** → **New query**.
2. Apri il file `supabase/schema.sql` di questo progetto, copia **tutto** il contenuto e incollalo nell’editor.
3. Premi **Run**. Deve comparire *Success. No rows returned*.
   Lo script crea le tabelle (capi, registro "indossato", misure), il contenitore privato `wardrobe` per le foto e le regole di sicurezza (RLS) che rendono ogni dato visibile solo al tuo utente. Si può rieseguire senza danni.

### 3. Crea il tuo utente e chiudi le iscrizioni
1. Menu **Authentication** → **Users** → **Add user** → **Create new user**.
2. Inserisci la tua email e una password robusta. Spunta **Auto Confirm User**. Conferma.
3. Copia l’**UID** del nuovo utente (la stringa lunga nella colonna UID): ti serve al passo 6.
4. Sempre in **Authentication**, apri le impostazioni di accesso (voce **Sign In / Providers**, o simile) e **disattiva “Allow new users to sign up”**. Salva.
   Così nessun altro può registrarsi: l’unico account resta il tuo.

### 4. Copia i due valori pubblici del progetto
Ti servono più avanti, al passo 9. Tienili in una nota temporanea.
- **Project URL**: si trova premendo **Connect** in alto, oppure in **Project Settings → Data API**. Ha la forma `https://abcdefghijkl.supabase.co`.
- **Publishable key**: **Project Settings → API Keys**, inizia con `sb_publishable_`.

Questi due valori sono pensati per stare nel browser: la chiave *pubblicabile* non protegge nulla da sola, i dati li protegge la RLS creata al passo 2.
**Non copiare** la chiave `sb_secret_…` (né la vecchia `service_role`): non serve all’app e non deve mai uscire da Supabase.

### 5. Pubblica la funzione che parla con l’AI
1. Menu **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nome della funzione: **`ai`** (esattamente così, minuscolo).
3. Cancella il codice di esempio, apri il file `supabase/functions/ai/index.ts`, copia tutto e incollalo.
4. **Deploy function**. Lascia attiva la verifica del JWT (è l’impostazione predefinita): la funzione risponde solo a te dopo l’accesso.

### 6. Inserisci la chiave Ollama come segreto
1. In un’altra scheda vai su [ollama.com/settings/keys](https://ollama.com/settings/keys) e crea una nuova chiave (nome: `guardaroba`). Copiala.
2. Torna su Supabase: **Edge Functions** → **Secrets** (in alcune versioni: **Edge Functions → Manage secrets**).
3. Aggiungi:
   | Name | Value |
   |---|---|
   | `OLLAMA_API_KEY` | la chiave appena copiata |
   | `ALLOWED_USER_ID` | l’UID copiato al passo 3 |
4. **Save**. Poi cancella la chiave dagli appunti (copia qualunque altra cosa).

Facoltativo: un terzo segreto `OLLAMA_VISION_MODELS` per scegliere i modelli, separati da virgola. Senza, la funzione usa `gemma4:31b` e, se non risponde, `glm-5.3-flash` (modelli cloud con visione verificati sulla documentazione Ollama a ottobre 2026).

---

## Parte B — GitHub (dove vive l’app)

### 7. Crea il repository
1. Su [github.com/new](https://github.com/new): nome `guardaroba`, visibilità **Public**.
   GitHub Pages gratuito funziona solo con repository pubblici. Va bene: nel codice non c’è alcun segreto, e lo verifichi al passo 8.
2. Non aggiungere README né .gitignore (ci sono già). **Create repository**.
3. Subito: **Settings → Advanced Security** (o **Code security**) e attiva **Secret Protection** e **Push protection**. Se in futuro una chiave finisse per sbaglio in un file, GitHub bloccherebbe il caricamento.

### 8. Carica i file
1. Decomprimi `guardaroba.zip` sul computer.
2. *(Facoltativo, su Mac)* Controllo finale dei segreti: apri il Terminale, trascina dentro la cartella dopo aver scritto `cd `, premi Invio, poi scrivi `bash tools/check-secrets.sh`. Deve rispondere `OK: nessuna chiave o segreto trovato.`
3. Nella pagina del repository vuoto clicca **uploading an existing file**.
4. Apri la cartella `guardaroba` e trascina nella pagina **il suo contenuto** (non la cartella stessa): `index.html` deve finire nella radice del repository.
   Su Mac il file `.gitignore` è nascosto: nel Finder premi `Cmd + Shift + .` per vederlo e trascinarlo insieme agli altri.
5. In fondo: **Commit changes**.

### 9. Inserisci i due valori pubblici
1. Nel repository apri `js/config.js` e premi la **matita** (Edit).
2. Incolla tra le virgolette i valori del passo 4:
   ```js
   export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co'
   export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...'
   ```
3. **Commit changes**.

### 10. Attiva GitHub Pages
1. **Settings → Pages**.
2. In **Build and deployment**: Source **Deploy from a branch**, Branch **main**, cartella **/ (root)**. **Save**.
3. Dopo 1–2 minuti in cima alla pagina compare l’indirizzo, del tipo `https://tuonome.github.io/guardaroba/`. Aprilo dal computer: deve comparire la schermata di accesso.

---

## Parte C — iPhone

### 11. Installa l’app sulla Home
1. Apri l’indirizzo del passo 10 con **Safari** (non con altri browser).
2. Tocca **Condividi** (quadrato con freccia) → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Apri l’app **dall’icona sulla Home** e accedi con email e password del passo 3.
   L’app installata ha una memoria separata da Safari: l’accesso va fatto lì dentro.
4. Alla prima apertura di **Oggi** consenti l’accesso alla **posizione** (serve solo per il meteo). Se preferisci di no, imposta una città in **Impostazioni** (ingranaggio in alto a destra).
5. Alla prima foto consenti l’accesso alla **fotocamera**.

### 12. Prova completa (5 minuti)
1. **Armadio → +**: fotografa una camicia e la sua etichetta. Dopo qualche secondo i campi segnati “letto” si compilano: controlla, scegli stagioni, occasioni e “come ti veste”, **Salva**.
2. Aggiungi almeno un paio di pantaloni e un paio di scarpe con l’occasione giusta: da lì **Oggi** inizia a proporre outfit.
3. **Misure**: inserisci torace, vita, collo e piede, **Salva le misure**: compare la tabella delle taglie.
4. **Negozio**: fotografa un capo qualsiasi, indica il prezzo, **Valuta**.
5. Metti l’iPhone in modalità aereo e riapri l’app: armadio, outfit e misure restano consultabili; le modifiche partono al ritorno della rete (pallino giallo con il numero in attesa, verde quando tutto è inviato).

---

## Se qualcosa non va

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| “Manca la configurazione” | `js/config.js` vuoto | Passo 9 |
| “Email o password non corrette” | Utente non creato o non confermato | Passo 3, spunta *Auto Confirm User* |
| Le foto non vengono lette: “Secret OLLAMA_API_KEY non impostato” | Segreto mancante o con nome diverso | Passo 6, nome esatto `OLLAMA_API_KEY` |
| “Utente non autorizzato” | `ALLOWED_USER_ID` diverso dal tuo UID | Ricopia l’UID dal passo 3 |
| “AI non disponibile (… HTTP 401 …)” | Chiave Ollama errata o revocata | Creane una nuova e sostituisci il segreto |
| “AI non disponibile (… HTTP 404 …)” | Modello ritirato da Ollama | Imposta `OLLAMA_VISION_MODELS` con un modello attuale (elenco: [ollama.com/search?c=cloud](https://ollama.com/search?c=cloud)) |
| Errore di salvataggio “permission denied” o “row-level security” | Script del passo 2 non eseguito tutto | Rieseguilo per intero |
| Dopo un aggiornamento del codice l’iPhone mostra la versione vecchia | Copia locale dell’app | Chiudi l’app dal multitasking e riaprila due volte |

## Aggiornare l’app in futuro
Modifica i file su GitHub (matita → Commit). Se cambi file in `js/` o `css/`, aumenta anche il numero di versione nella prima riga utile di `sw.js` (`guardaroba-v1` → `guardaroba-v2`): così l’iPhone scarica subito la nuova versione.
Se cambi `supabase/functions/ai/index.ts`, ripeti il passo 5 incollando il nuovo codice nella funzione esistente.

## Se una chiave dovesse finire per sbaglio dove non deve
1. Revocala subito alla fonte (Ollama: [ollama.com/settings/keys](https://ollama.com/settings/keys); Supabase: Project Settings → API Keys).
2. Creane una nuova e aggiornala solo nei Secrets (passo 6).
3. Cancellare il file da GitHub non basta: la chiave resta nella cronologia. Conta solo la revoca.

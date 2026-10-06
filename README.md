# Guardaroba

Web app personale per iPhone: catalogo di capi e calzature con lettura delle etichette, misure e taglie di riferimento, outfit del giorno in base a meteo, occasione e rotazione, valutazione degli acquisti in negozio.

- **Mettere online**: [SETUP.md](SETUP.md)
- **Scelte, limiti, app nativa**: [NOTES.md](NOTES.md)

| Cartella | Contenuto |
|---|---|
| `index.html`, `css/`, `js/`, `icons/`, `sw.js`, `manifest.webmanifest`, `vendor/` | l’app (pubblicata da GitHub Pages) |
| `supabase/schema.sql` | tabelle, storage e regole di sicurezza |
| `supabase/functions/ai/index.ts` | funzione che chiama Ollama con la chiave custodita come secret |
| `tools/check-secrets.sh` | controllo anti-chiavi prima della pubblicazione |

Nessuna chiave segreta è contenuta in questo repository. `js/config.js` contiene solo l’URL del progetto Supabase e la chiave pubblicabile, protetta dalla Row Level Security.

// =====================================================================
// Supabase Edge Function "ai" — unico ponte tra l'app e Ollama Cloud.
//
// * La chiave Ollama vive SOLO qui, come secret OLLAMA_API_KEY
//   (Dashboard → Edge Functions → Secrets). Non va mai nel frontend.
// * Accetta solo chiamate di un utente autenticato (JWT di Supabase),
//   verificato da @supabase/server. CORS gestito dal wrapper.
// * Facoltativo: secret ALLOWED_USER_ID = il tuo id utente, per rifiutare
//   chiunque altro anche se per errore le iscrizioni restassero aperte.
// * Facoltativo: secret OLLAMA_VISION_MODELS = elenco separato da virgole
//   dei modelli da provare in ordine (default sotto).
//
// API Ollama verificata su docs.ollama.com (ottobre 2026):
//   POST https://ollama.com/api/chat   Authorization: Bearer <chiave>
//   immagini: messages[].images = [base64], output strutturato: "format".
// =====================================================================
import { withSupabase } from 'npm:@supabase/server@1'

const OLLAMA_URL = 'https://ollama.com/api/chat'
const DEFAULT_MODELS = 'gemma4:31b,glm-5.3-flash'
const MAX_IMAGE_B64 = 3_500_000 // ~2,6 MB per immagine dopo la compressione lato app
const OLLAMA_TIMEOUT_MS = 70_000

// Codici condivisi con l'app (js/taxonomy.js). Se ne aggiungi uno lì, aggiungilo anche qui.
const CATEGORIES = [
  'shirt', 'tshirt', 'polo', 'knit', 'sweatshirt', 'vest',
  'blazer', 'jacket', 'coat', 'raincoat',
  'trousers', 'jeans', 'shorts',
  'shoes_formal', 'loafers', 'sneakers', 'boots', 'sport_shoes', 'sandals',
]
const COLORS = [
  'black', 'charcoal', 'grey', 'white', 'cream', 'beige', 'camel', 'brown',
  'navy', 'blue', 'light_blue', 'denim', 'olive', 'green', 'burgundy', 'red',
  'pink', 'yellow', 'orange', 'purple',
]
const SYSTEMS = ['IT', 'EU', 'UK', 'US', 'LETTER']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const OCCASIONS = ['formal', 'work', 'casual', 'sport']

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ---------- Schemi di output -----------------------------------------
const sizeSchema = {
  type: 'object',
  properties: {
    system: { type: 'string', enum: SYSTEMS },
    label: { type: 'string' },
  },
  required: ['system', 'label'],
}

const ANALYZE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['garment', 'footwear'] },
    category: { type: 'string', enum: [...CATEGORIES, 'unknown'] },
    brand: { type: 'string' },
    color_primary: { type: 'string', enum: [...COLORS, 'unknown'] },
    colors_secondary: { type: 'array', items: { type: 'string', enum: COLORS } },
    composition: {
      type: 'array',
      items: {
        type: 'object',
        properties: { fiber: { type: 'string' }, pct: { type: 'number' } },
        required: ['fiber', 'pct'],
      },
    },
    fit: { type: 'string' },
    sizes: { type: 'array', items: sizeSchema },
    care: { type: 'array', items: { type: 'string' } },
    warmth: { type: 'integer', enum: [0, 1, 2, 3] },
    seasons: { type: 'array', items: { type: 'string', enum: SEASONS } },
    occasions: { type: 'array', items: { type: 'string', enum: OCCASIONS } },
    label_readable: { type: 'boolean' },
  },
  required: ['kind', 'category', 'brand', 'color_primary', 'colors_secondary', 'composition', 'fit',
    'sizes', 'care', 'warmth', 'seasons', 'occasions', 'label_readable'],
}

const SIZE_GUIDE_SCHEMA = {
  type: 'object',
  properties: {
    brand: { type: 'string' },
    system: { type: 'string', enum: SYSTEMS },
    unit: { type: 'string', enum: ['cm', 'inch'] },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          size: { type: 'string' },
          chest_min: { type: 'number' }, chest_max: { type: 'number' },
          waist_min: { type: 'number' }, waist_max: { type: 'number' },
          hips_min: { type: 'number' }, hips_max: { type: 'number' },
          neck_min: { type: 'number' }, neck_max: { type: 'number' },
          inseam_min: { type: 'number' }, inseam_max: { type: 'number' },
          foot_min: { type: 'number' }, foot_max: { type: 'number' },
        },
        required: ['size', 'chest_min', 'chest_max', 'waist_min', 'waist_max', 'hips_min', 'hips_max',
          'neck_min', 'neck_max', 'inseam_min', 'inseam_max', 'foot_min', 'foot_max'],
      },
    },
  },
  required: ['brand', 'system', 'unit', 'rows'],
}

// ---------- Prompt ---------------------------------------------------
function analyzePrompt(hasPhoto: boolean, hasLabel: boolean): string {
  const which = hasPhoto && hasLabel
    ? 'La PRIMA immagine è il capo intero, la SECONDA è la sua etichetta.'
    : hasLabel ? "L'immagine è l'etichetta interna di un capo (il capo intero non è visibile)."
    : "L'immagine è un capo d'abbigliamento o una calzatura da uomo."
  return `${which}
Estrai i dati e rispondi SOLO con JSON conforme allo schema. Regole:
- category: uno tra ${CATEGORIES.join(', ')}. blazer = giacca sartoriale; jacket = giubbotto/bomber/giacca casual; knit = maglione o cardigan; vest = gilet. Se non riconoscibile: 'unknown'.
- kind: 'footwear' per le scarpe, altrimenti 'garment'.
- color_primary e colors_secondary: dal capo intero (non dall'etichetta). Codici ammessi: ${COLORS.join(', ')} ('unknown' se non visibile). navy = blu scuro; denim = blu jeans. Massimo 3 colori secondari, solo se ben visibili.
- composition: fibre e percentuali come scritte in etichetta, fibra in italiano minuscolo (es. cotone, lana, elastan, poliestere, lino, cashmere, viscosa). Lista vuota se illeggibile.
- sizes: TUTTE le taglie leggibili sull'etichetta con il loro sistema: IT, EU, UK, US, oppure LETTER per XS/S/M/L/XL. Per i pantaloni US scrivi la label come "W32 L34" o "32". Le taglie camicia in cm (es. 41) sono IT. Se il sistema non è indicato e il numero è tipico italiano (44-60) usa IT. Lista vuota se non leggibile.
- fit: vestibilità se scritta (es. slim, regular, comfort, tailored), altrimenti stringa vuota.
- care: istruzioni di lavaggio in italiano breve (es. "Lavaggio a 30°", "Non candeggiare", "Stiro a bassa temperatura", "Lavaggio a secco", "Non asciugare in asciugatrice"), dai simboli o dal testo.
- brand: se leggibile, altrimenti stringa vuota.
- warmth: 1 leggero, 2 medio, 3 pesante (stima da tipo di capo e fibre); 0 se non stimabile.
- seasons e occasions: stima prudente. occasions: formal = lavoro formale (riunioni di CdA), work = lavoro informale, casual, sport.
- label_readable: false se l'etichetta manca o è illeggibile.
Non inventare: se un dato non è leggibile, usa 'unknown', stringa vuota, 0 o lista vuota.`
}

const SIZE_GUIDE_PROMPT = `L'immagine è la guida taglie di un marchio di abbigliamento o scarpe.
Trascrivi ogni riga della tabella in JSON conforme allo schema:
- brand: il marchio se scritto, altrimenti stringa vuota.
- size: la taglia come scritta (es. "48", "M", "41", "W32", "42.5").
- system: IT, EU, UK, US o LETTER secondo la colonna usata come taglia principale.
- unit: "cm" o "inch" (unità delle misure).
- per ciascuna misura corporea (torace/petto=chest, vita=waist, fianchi/bacino=hips, collo=neck, cavallo interno=inseam, lunghezza piede=foot) riporta minimo e massimo; se c'è un solo valore, usa lo stesso per min e max; 0 se la misura non c'è.
Non inventare valori.`

// ---------- Utilità --------------------------------------------------
function modelList(): string[] {
  return (Deno.env.get('OLLAMA_VISION_MODELS') ?? DEFAULT_MODELS)
    .split(',').map((s) => s.trim()).filter(Boolean)
}

function cleanImage(v: unknown, name: string): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string') throw new HttpError(400, `${name}: formato non valido`)
  const b64 = v.replace(/^data:image\/[a-z]+;base64,/, '')
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new HttpError(400, `${name}: base64 non valido`)
  if (b64.length > MAX_IMAGE_B64) throw new HttpError(413, `${name}: immagine troppo grande`)
  return b64
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try { return JSON.parse(t) } catch { /* continua */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1))
  throw new Error('risposta del modello non in JSON')
}

async function callOllama(prompt: string, images: string[], schema: object) {
  const key = Deno.env.get('OLLAMA_API_KEY')
  if (!key) throw new HttpError(500, 'Secret OLLAMA_API_KEY non impostato nella Edge Function')
  const errors: string[] = []
  for (const model of modelList()) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), OLLAMA_TIMEOUT_MS)
    try {
      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: schema,
          options: { temperature: 0 },
          messages: [{
            role: 'user',
            content: `${prompt}\n\nSchema JSON da rispettare:\n${JSON.stringify(schema)}`,
            images,
          }],
        }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200)
        errors.push(`${model}: HTTP ${res.status} ${body}`)
        continue
      }
      const data = await res.json()
      const content: string = data?.message?.content ?? ''
      return { model, result: parseJson(content) }
    } catch (e) {
      errors.push(`${model}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      clearTimeout(timer)
    }
  }
  console.error('Ollama non raggiungibile', errors) // nessun dato sensibile: solo modello e stato
  throw new HttpError(502, `AI non disponibile (${errors.join(' | ').slice(0, 300)})`)
}

// ---------- Handler --------------------------------------------------
export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Usa POST')
      const allowed = Deno.env.get('ALLOWED_USER_ID')
      if (allowed && ctx.userClaims?.id !== allowed) throw new HttpError(403, 'Utente non autorizzato')

      const body = await req.json().catch(() => { throw new HttpError(400, 'JSON non valido') })
      const action = body?.action

      if (action === 'analyze') {
        const photo = cleanImage(body.photo, 'photo')
        const label = cleanImage(body.label, 'label')
        if (!photo && !label) throw new HttpError(400, 'Serve almeno una foto (capo o etichetta)')
        const images = [photo, label].filter((x): x is string => !!x)
        const out = await callOllama(analyzePrompt(!!photo, !!label), images, ANALYZE_SCHEMA)
        return Response.json(out)
      }

      if (action === 'size_guide') {
        const image = cleanImage(body.image, 'image')
        if (!image) throw new HttpError(400, 'Manca la foto della guida taglie')
        const out = await callOllama(SIZE_GUIDE_PROMPT, [image], SIZE_GUIDE_SCHEMA)
        return Response.json(out)
      }

      throw new HttpError(400, 'Azione sconosciuta')
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      const message = e instanceof Error ? e.message : 'Errore'
      return Response.json({ error: message }, { status })
    }
  }),
}

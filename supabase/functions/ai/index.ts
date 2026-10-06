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
//   POST https://ollama.com/api/chat        Authorization: Bearer <chiave>
//   immagini: messages[].images = [base64], output strutturato: "format".
//   POST https://ollama.com/api/web_search  { query, max_results ≤ 10 }
//     → { results: [{ title, url, content }] }  (stessa chiave)
//
// Azioni: analyze (foto capo/etichetta), size_guide (guida taglie),
//         lookup (cerca il prodotto online dai codici dell'etichetta),
//         fetch_image (scarica la foto di catalogo scelta).
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
  'navy', 'blue', 'light_blue', 'denim', 'olive', 'sage', 'green', 'burgundy', 'red',
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
    article_code: { type: 'string' },
    color_code: { type: 'string' },
    color_name: { type: 'string' },
    ean: { type: 'string' },
    model_name: { type: 'string' },
  },
  required: ['kind', 'category', 'brand', 'color_primary', 'colors_secondary', 'composition', 'fit',
    'sizes', 'care', 'warmth', 'seasons', 'occasions', 'label_readable',
    'article_code', 'color_code', 'color_name', 'ean', 'model_name'],
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
- color_primary e colors_secondary: dal capo intero. Se c'è solo l'etichetta, usa un colore solo se è scritto (es. "Col. Navy", "Colore: blu"), altrimenti 'unknown' e lista vuota. Codici ammessi: ${COLORS.join(', ')} ('unknown' se non visibile). navy = blu scuro; denim = blu jeans; sage = verde salvia (verde grigiastro chiaro e smorzato); olive = verde oliva (scuro, tendente al marrone). Massimo 3 colori secondari, solo se ben visibili.
- composition: fibre e percentuali come scritte in etichetta, fibra in italiano minuscolo (es. cotone, lana, elastan, poliestere, lino, cashmere, viscosa). Lista vuota se illeggibile.
- sizes: TUTTE le taglie leggibili sull'etichetta con il loro sistema: IT, EU, UK, US, oppure LETTER per XS/S/M/L/XL. Per i pantaloni US scrivi la label come "W32 L34" o "32". Le taglie camicia in cm (es. 41) sono IT. Se il sistema non è indicato e il numero è tipico italiano (44-60) usa IT. Lista vuota se non leggibile.
- fit: vestibilità se scritta (es. slim, regular, comfort, tailored), altrimenti stringa vuota.
- care: istruzioni di lavaggio in italiano breve (es. "Lavaggio a 30°", "Non candeggiare", "Stiro a bassa temperatura", "Lavaggio a secco", "Non asciugare in asciugatrice"), dai simboli o dal testo.
- brand: se leggibile, altrimenti stringa vuota.
- warmth: 1 leggero, 2 medio, 3 pesante (stima da tipo di capo e fibre); 0 se non stimabile.
- seasons e occasions: stima prudente. occasions: formal = lavoro formale (riunioni di CdA), work = lavoro informale, casual, sport.
- label_readable: false se l'etichetta manca o è illeggibile.
- article_code: codice articolo/modello/stile stampato su etichetta o cartellino (es. "Art. 12345", "Style 503812", "Mod. AB12", "REF 1234/567/800" → "1234/567"). Senza il codice colore, se è distinguibile. Stringa vuota se assente.
- color_code: codice del colore o della variante se distinguibile (es. "Col. 410", "Colour 001", l'ultimo blocco di "REF 1234/567/800" → "800"). Stringa vuota se assente.
- color_name: il nome del colore come scritto (es. "Navy", "Blu notte", "Ecru"). Stringa vuota se non scritto.
- ean: le cifre stampate sotto il codice a barre (8, 12 o 13 cifre), solo se le leggi TUTTE con certezza. Stringa vuota altrimenti.
- model_name: nome commerciale del modello se scritto (es. "Oxford slim", "501 Original"). Stringa vuota se assente.
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

// ---------- Ricerca del prodotto online (azione "lookup") -------------
// Cerca con l'API web_search di Ollama usando i codici letti in etichetta,
// poi legge le pagine prodotto (dati strutturati schema.org e Open Graph)
// e decide quanto il risultato corrisponde al capo:
//   exact    = codice a barre, oppure codice articolo + codice colore
//   model    = codice articolo trovato, colore da confermare
//   possible = stessa marca, pagina prodotto plausibile
// Le pagine vengono scaricate solo da indirizzi https pubblici, con limiti
// di tempo, dimensione e reindirizzamenti.
const SEARCH_URL = 'https://ollama.com/api/web_search'
const PAGE_TIMEOUT_MS = 9_000
const PAGE_MAX_BYTES = 2_500_000
const IMAGE_MAX_BYTES = 8_000_000
const MAX_PAGES = 6
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const SKIP_HOSTS = /(^|\.)(pinterest\.[a-z.]+|youtube\.com|facebook\.com|instagram\.com|tiktok\.com|reddit\.com|wikipedia\.org|x\.com|twitter\.com|amazonaws\.com)$/
const CATEGORY_WORDS: Record<string, string> = {
  shirt: 'camicia', tshirt: 't-shirt', polo: 'polo', knit: 'maglione', sweatshirt: 'felpa', vest: 'gilet',
  blazer: 'giacca', jacket: 'giubbotto', coat: 'cappotto', raincoat: 'impermeabile', trousers: 'pantaloni',
  jeans: 'jeans', shorts: 'bermuda', shoes_formal: 'scarpe', loafers: 'mocassini', sneakers: 'sneakers',
  boots: 'stivaletti', sport_shoes: 'scarpe sportive', sandals: 'sandali',
}

export type Variant = { color: string; sku: string; gtins: string[]; image: string; url: string }
export type Candidate = {
  url: string; domain: string; title: string; brand: string; image: string
  price: number | null; currency: string; color: string; material: string
  sku: string; gtins: string[]; variants: Variant[]; isProduct: boolean; source: 'page' | 'search'
}
export type Query = {
  brand: string; article_code: string; color_code: string; color_name: string
  ean: string; model_name: string; category: string
}
export type Match = Candidate & {
  level: 'exact' | 'model' | 'possible'; why: string; variant: number; suggested: number
}

// Normalizzazione per confrontare codici e nomi ("1234/567-800" → "1234567800")
export const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

export function validEan(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false
  const d = code.split('').map(Number)
  const check = d.pop()!
  const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

// --- Indirizzi: solo https verso host pubblici --------------------------
function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v6 = ip.toLowerCase()
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') ||
    v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('::ffff:')
}

export function checkUrlShape(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const bad = url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[') ||
    /(^|\.)(localhost|local|internal|lan|home|corp|intranet|arpa)$/.test(host)
  if (bad) throw new HttpError(400, 'Indirizzo non ammesso')
}

async function assertPublic(url: URL): Promise<void> {
  checkUrlShape(url)
  const addrs: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    try { addrs.push(...await Deno.resolveDns(url.hostname, type)) } catch { /* risoluzione non disponibile o assente */ }
  }
  if (addrs.some(isPrivateIp)) throw new HttpError(400, 'Indirizzo non ammesso')
}

async function safeFetch(raw: string, accept: string, maxBytes: number, timeoutMs: number) {
  let url = new URL(raw)
  if (url.protocol === 'http:') url.protocol = 'https:'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url)
      const res = await fetch(url, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7' },
      })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel()
        url = new URL(loc, url)
        if (url.protocol === 'http:') url.protocol = 'https:'
        continue
      }
      if (!res.ok || !res.body) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`) }
      if (Number(res.headers.get('content-length') || 0) > maxBytes) { await res.body.cancel(); throw new Error('file troppo grande') }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > maxBytes) { await reader.cancel(); throw new Error('file troppo grande') }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let o = 0
      for (const c of chunks) { bytes.set(c, o); o += c.length }
      return { url: url.toString(), type: (res.headers.get('content-type') || '').toLowerCase(), bytes }
    }
    throw new Error('troppi reindirizzamenti')
  } finally {
    clearTimeout(timer)
  }
}

// --- Lettura della pagina prodotto --------------------------------------
const ENT: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENT[k] ?? m
  })
}

function parseAttrs(tag: string): Record<string, string> {
  const a: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ''
  return a
}

function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttrs(m[0])
    const key = (a.property || a.name || a.itemprop || '').toLowerCase()
    if (key && a.content && !(key in out)) out[key] = decodeEntities(a.content).trim()
  }
  return out
}

// deno-lint-ignore no-explicit-any
type Node = Record<string, any>
function jsonLdNodes(html: string): Node[] {
  const out: Node[] = []
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const txt = m[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
    let data: unknown
    try { data = JSON.parse(txt) } catch { try { data = JSON.parse(decodeEntities(txt)) } catch { continue } }
    const stack: unknown[] = [data]
    let guard = 0
    while (stack.length && guard++ < 2000) {
      const n = stack.pop()
      if (Array.isArray(n)) { stack.push(...n); continue }
      if (!n || typeof n !== 'object') continue
      const node = n as Node
      const types = ([] as unknown[]).concat(node['@type'] ?? []).map(String)
      if (types.some((t) => /^(Product|ProductGroup|IndividualProduct|ProductModel)$/i.test(t))) out.push(node)
      for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v)
    }
  }
  return out
}

const isGroup = (n: Node) => ([] as unknown[]).concat(n['@type'] ?? []).some((t) => /ProductGroup/i.test(String(t)))

function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return decodeEntities(v).trim()
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return str(v[0])
  if (typeof v === 'object') return str((v as Node).name ?? (v as Node)['@value'] ?? '')
  return ''
}
function imageOf(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) { for (const x of v) { const s = imageOf(x); if (s) return s } return '' }
  if (typeof v === 'object') return String((v as Node).url ?? (v as Node).contentUrl ?? (v as Node)['@id'] ?? '').trim()
  return ''
}
function gtinsOf(n: Node): string[] {
  const out = new Set<string>()
  for (const k of ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'ean']) {
    for (const v of ([] as unknown[]).concat(n[k] ?? [])) {
      const d = String(v).replace(/\D/g, '')
      if (d.length >= 8) out.add(d.length === 12 ? '0' + d : d)
    }
  }
  return [...out]
}
function priceOf(n: Node): { price: number | null; currency: string } {
  for (const o of ([] as Node[]).concat(n.offers ?? [])) {
    if (!o || typeof o !== 'object') continue
    const p = Number(String(o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? '').replace(',', '.'))
    if (Number.isFinite(p) && p > 0) return { price: p, currency: str(o.priceCurrency) }
  }
  return { price: null, currency: '' }
}
function abs(u: string, base: string): string {
  if (!u || u.startsWith('data:')) return ''
  try {
    const x = new URL(u, base)
    if (x.protocol === 'http:') x.protocol = 'https:'
    return x.protocol === 'https:' ? x.toString() : ''
  } catch { return '' }
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }

export function parseProductPage(html: string, pageUrl: string): Candidate {
  const meta = metaTags(html)
  const nodes = jsonLdNodes(html)
  const group = nodes.find(isGroup)
  const products = nodes.filter((n) => !isGroup(n))
  const main: Node = group ?? products[0] ?? {}
  const titleTag = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()

  const rawVariants: Node[] = group ? ([] as Node[]).concat(group.hasVariant ?? []) : products.length > 1 ? products : []
  const byColor = new Map<string, Variant>()
  for (const v of rawVariants) {
    if (!v || typeof v !== 'object') continue
    const color = str(v.color)
    const key = norm(color) || norm(str(v.sku)) || String(byColor.size)
    const cur = byColor.get(key)
    const item: Variant = cur ?? {
      color, sku: str(v.sku) || str(v.mpn), gtins: [],
      image: abs(imageOf(v.image), pageUrl), url: abs(str(v.url) || str(([] as Node[]).concat(v.offers ?? [])[0]?.url), pageUrl),
    }
    item.gtins = [...new Set([...item.gtins, ...gtinsOf(v)])]
    if (!item.image) item.image = abs(imageOf(v.image), pageUrl)
    byColor.set(key, item)
    if (byColor.size >= 24) break
  }
  const { price, currency } = priceOf(main)
  const metaPrice = Number(String(meta['product:price:amount'] ?? meta['og:price:amount'] ?? '').replace(',', '.'))
  return {
    url: pageUrl,
    domain: hostOf(pageUrl),
    title: str(main.name) || meta['og:title'] || titleTag,
    brand: str(main.brand) || meta['product:brand'] || meta['og:brand'] || '',
    image: abs(imageOf(main.image), pageUrl) || abs(meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || '', pageUrl),
    price: price ?? (Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice : null),
    currency: currency || meta['product:price:currency'] || meta['og:price:currency'] || '',
    color: str(main.color) || meta['product:color'] || '',
    material: str(main.material),
    sku: str(main.sku) || str(main.mpn) || meta['product:retailer_item_id'] || '',
    gtins: gtinsOf(main),
    variants: [...byColor.values()],
    isProduct: nodes.length > 0 || /product/i.test(meta['og:type'] ?? ''),
    source: 'page',
  }
}

// --- Quanto corrisponde --------------------------------------------------
export function scoreCandidate(c: Candidate, text: string, q: Query): Match | null {
  const compact = norm(text)
  const tokens = new Set(text.toLowerCase().split(/[^a-z0-9]+/))
  const has = (code: string) => code.length >= 6 ? compact.includes(code) : code.length >= 3 && tokens.has(code)
  const ean = validEan(q.ean) ? q.ean : ''
  const ean13 = ean.length === 12 ? '0' + ean : ean
  const art = norm(q.article_code), col = norm(q.color_code)
  const allG = new Set([...c.gtins, ...c.variants.flatMap((v) => v.gtins)])
  let level: Match['level'] | null = null, why = '', variant = -1

  if (ean && (allG.has(ean13) || allG.has(ean) || compact.includes(ean))) {
    level = 'exact'; why = 'codice a barre'
    variant = c.variants.findIndex((v) => v.gtins.includes(ean13) || v.gtins.includes(ean))
  } else if (art && has(art)) {
    level = 'model'; why = 'codice articolo'
    if (col) {
      const vi = c.variants.findIndex((v) => {
        const s = norm(v.sku), u = norm(v.url)
        return (s.includes(art) && s.includes(col)) || s === col || u.includes(art + col)
      })
      if (vi >= 0) { level = 'exact'; variant = vi; why = 'codice articolo e colore' }
      else if (compact.includes(art + col) || (c.variants.length <= 1 && has(col))) { level = 'exact'; why = 'codice articolo e colore' }
    }
  } else {
    const brand = norm(q.brand)
    const brandOk = !brand || norm(`${c.brand} ${c.title} ${c.domain}`).includes(brand.slice(0, 12))
    const model = norm(q.model_name)
    const modelOk = !model || compact.includes(model)
    if (brandOk && c.isProduct && (modelOk || !q.model_name)) { level = 'possible'; why = model && modelOk ? 'marca e nome del modello' : 'marca' }
  }
  if (!level) return null
  // colore scritto in etichetta: suggerisce la variante, senza dichiararla certa
  let suggested = variant
  if (suggested < 0 && q.color_name) {
    const cn = norm(q.color_name)
    suggested = c.variants.findIndex((v) => norm(v.color) === cn)
    if (suggested < 0) suggested = c.variants.findIndex((v) => norm(v.color).includes(cn) || (norm(v.color).length > 2 && cn.includes(norm(v.color))))
  }
  if (suggested < 0 && col) suggested = c.variants.findIndex((v) => norm(v.sku).endsWith(col) || norm(v.url).includes(col))
  return { ...c, level, why, variant, suggested }
}

const RANK = { exact: 3, model: 2, possible: 1 }

export function buildQueries(q: Query): string[] {
  const out: string[] = []
  const cat = CATEGORY_WORDS[q.category] ?? ''
  if (validEan(q.ean)) out.push(q.ean)
  if (q.article_code) {
    out.push([q.brand, q.article_code, q.color_code].filter(Boolean).join(' '))
    if (q.color_code) out.push([q.brand, q.article_code].filter(Boolean).join(' '))
  } else if (q.model_name) {
    out.push([q.brand, q.model_name, cat].filter(Boolean).join(' '))
  } else if (q.brand && cat) {
    out.push([q.brand, cat, q.color_name].filter(Boolean).join(' '))
  }
  return [...new Set(out.map((s) => s.trim()).filter((s) => s.length >= 4))].slice(0, 3)
}

async function webSearch(query: string): Promise<{ title: string; url: string; content: string }[]> {
  const key = Deno.env.get('OLLAMA_API_KEY')
  if (!key) throw new HttpError(500, 'Secret OLLAMA_API_KEY non impostato nella Edge Function')
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: 6 }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new HttpError(502, `Ricerca web non disponibile (HTTP ${res.status})`)
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  return (data?.results ?? []).map((r: any) => ({ title: String(r?.title ?? ''), url: String(r?.url ?? ''), content: String(r?.content ?? '').slice(0, 3000) }))
}

function cleanText(v: unknown, max = 80): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : ''
}

export async function lookup(body: Node) {
  const q: Query = {
    brand: cleanText(body.brand), article_code: cleanText(body.article_code, 40), color_code: cleanText(body.color_code, 20),
    color_name: cleanText(body.color_name, 40), ean: cleanText(body.ean, 14).replace(/\D/g, ''),
    model_name: cleanText(body.model_name), category: cleanText(body.category, 20),
  }
  const queries = buildQueries(q)
  if (!queries.length) return { level: 'none', queries, candidates: [], note: 'Etichetta senza codici o marca: niente da cercare.' }

  const settled = await Promise.allSettled(queries.map(webSearch))
  if (settled.every((r) => r.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason
  // risultati in ordine, alternando le ricerche, senza doppioni
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []))
  const seen = new Set<string>()
  const hits: { title: string; url: string; content: string }[] = []
  for (let i = 0; i < 10; i++) {
    for (const list of lists) {
      const r = list[i]
      if (!r) continue
      let u: URL
      try { u = new URL(r.url) } catch { continue }
      if (u.protocol === 'http:') u.protocol = 'https:'
      u.hash = ''
      const host = u.hostname.toLowerCase()
      if (u.protocol !== 'https:' || SKIP_HOSTS.test(host) || seen.has(u.toString())) continue
      seen.add(u.toString())
      hits.push({ ...r, url: u.toString() })
    }
  }

  const pages = await Promise.allSettled(hits.slice(0, MAX_PAGES).map(async (hit) => {
    const page = await safeFetch(hit.url, 'text/html,application/xhtml+xml', PAGE_MAX_BYTES, PAGE_TIMEOUT_MS)
    if (!/html|xml/.test(page.type)) throw new Error('non è una pagina web')
    const charset = page.type.match(/charset=([\w-]+)/)?.[1] ?? 'utf-8'
    let html: string
    try { html = new TextDecoder(charset).decode(page.bytes) } catch { html = new TextDecoder().decode(page.bytes) }
    return { hit, html, url: page.url }
  }))

  const matches: Match[] = []
  pages.forEach((p, i) => {
    const hit = hits[i]
    if (p.status === 'fulfilled') {
      const cand = parseProductPage(p.value.html, p.value.url)
      const m = scoreCandidate(cand, `${p.value.html} ${hit.content}`, q)
      if (m) matches.push(m)
    } else {
      // pagina non scaricabile (molti negozi bloccano i download automatici): resta l'estratto della ricerca
      const cand: Candidate = {
        url: hit.url, domain: hostOf(hit.url), title: hit.title, brand: '', image: '', price: null, currency: '',
        color: '', material: '', sku: '', gtins: [], variants: [], isProduct: false, source: 'search',
      }
      const m = scoreCandidate(cand, `${hit.title} ${hit.content} ${hit.url}`, q)
      if (m && m.level !== 'possible') matches.push(m)
    }
  })

  matches.sort((a, b) => RANK[b.level] - RANK[a.level] || Number(!!b.image) - Number(!!a.image) || b.variants.length - a.variants.length)
  const candidates = matches.slice(0, 4)
  return { level: candidates[0]?.level ?? 'none', queries, candidates }
}

// --- Foto di catalogo -----------------------------------------------------
function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  return null
}
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function fetchImage(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 2000) throw new HttpError(400, 'Indirizzo immagine non valido')
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new HttpError(400, 'Indirizzo immagine non valido') }
  const img = await safeFetch(parsed.toString(), 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8', IMAGE_MAX_BYTES, 12_000)
    .catch((e) => { throw e instanceof HttpError ? e : new HttpError(502, `Foto non scaricabile (${e.message})`) })
  const mime = sniffImage(img.bytes)
  if (!mime) throw new HttpError(415, 'Il file scaricato non è un’immagine')
  return { mime, data: toBase64(img.bytes) }
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

      if (action === 'lookup') {
        return Response.json(await lookup(body))
      }

      if (action === 'fetch_image') {
        return Response.json(await fetchImage(body.url))
      }

      throw new HttpError(400, 'Azione sconosciuta')
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      const message = e instanceof Error ? e.message : 'Errore'
      return Response.json({ error: message }, { status })
    }
  }),
}

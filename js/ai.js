// Chiamate all'AI: passano SEMPRE dalla Edge Function "ai" su Supabase.
// Qui non c'è nessuna chiave Ollama: il browser invia solo il token di sessione dell'utente.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'
import { sb } from './store.js'
import { CATEGORIES, COLORS, SEASONS, OCCASIONS, SIZE_SYSTEMS, fabricFromComposition } from './taxonomy.js'

async function call(body, ms = 90000) {
  if (!navigator.onLine) throw new Error('Sei offline: compila i campi a mano, li puoi correggere dopo.')
  const { data } = await sb.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sessione scaduta: esci e rientra.')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ai`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || j.message || `Errore AI (${r.status})`)
    return j
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('L’AI non ha risposto in tempo: riprova o compila a mano.')
    if (e instanceof TypeError) throw new Error('Connessione assente o instabile: riprova o compila a mano.')
    throw e
  } finally { clearTimeout(t) }
}

const pick = (v, dict) => (v && v in dict ? v : null)
const txt = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Codice a barre: accettato solo con cifra di controllo corretta (un numero letto male non deve "corrispondere")
export function validEan(code) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code || '')) return false
  const d = code.split('').map(Number), check = d.pop()
  const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}
const pickAll = (arr, dict) => [...new Set((arr || []).filter((v) => v in dict))]

// Normalizza la risposta: scarta valori fuori vocabolario
export async function analyze({ photo, label }) {
  const { result: r, model } = await call({ action: 'analyze', photo, label })
  const sizes = (r.sizes || []).filter((s) => s && s.label && s.system in SIZE_SYSTEMS).map((s) => ({ system: s.system, label: String(s.label).trim() }))
  const category = pick(r.category, CATEGORIES)
  const composition = (r.composition || []).filter((c) => c?.fiber && isFinite(c.pct)).map((c) => ({ fiber: String(c.fiber).toLowerCase(), pct: Number(c.pct) }))
  return {
    model,
    readable: r.label_readable !== false,
    // dati per la ricerca online (non tutti finiscono nel capo)
    codes: {
      article_code: txt(r.article_code, 40) || null,
      color_code: txt(r.color_code, 20) || null,
      color_name: txt(r.color_name, 40) || null,
      ean: validEan(String(r.ean || '').replace(/\D/g, '')) ? String(r.ean).replace(/\D/g, '') : null,
      model_name: txt(r.model_name) || null,
    },
    fields: {
      kind: category ? CATEGORIES[category].kind : (r.kind === 'footwear' ? 'footwear' : null),
      category,
      brand: r.brand?.trim() || null,
      color_primary: pick(r.color_primary, COLORS),
      colors_secondary: pickAll(r.colors_secondary, COLORS).filter((c) => c !== r.color_primary).slice(0, 3),
      composition,
      fabric: fabricFromComposition(composition),
      fit: r.fit?.trim() || null,
      size_label: sizes[0]?.label || null,
      size_system: sizes[0]?.system || null,
      size_alt: sizes.slice(1),
      care: (r.care || []).map((s) => String(s).trim()).filter(Boolean),
      warmth: [1, 2, 3].includes(r.warmth) ? r.warmth : null,
      seasons: pickAll(r.seasons, SEASONS),
      occasions: pickAll(r.occasions, OCCASIONS),
    },
  }
}

export async function readSizeGuide(image) {
  const { result } = await call({ action: 'size_guide', image })
  return result
}

// Cerca il capo online dai codici dell'etichetta. Risposta: { level, candidates, queries }
// level: exact | model | possible | none
export async function lookup({ brand, article_code, color_code, color_name, ean, model_name, category }) {
  const r = await call({ action: 'lookup', brand, article_code, color_code, color_name, ean, model_name, category }, 60000)
  r.candidates = (r.candidates || []).filter((c) => c && c.url)
  return r
}

// C'è abbastanza per cercare? (marca con codice o nome del modello, oppure codice a barre)
// Con marca e tipo di capo, senza codici, la ricerca dà solo risultati "da identificare".
export const canLookup = (d) => !!(d?.ean || (d?.brand && (d?.article_code || d?.model_name || d?.category)) || (d?.article_code && String(d.article_code).length >= 6))

// Scarica la foto di catalogo passando dalla Edge Function (il browser non può leggerla direttamente)
export async function fetchImage(url) {
  const { mime, data } = await call({ action: 'fetch_image', url }, 30000)
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// Legge la pagina prodotto di un link incollato: stessa risposta di lookup, con un solo risultato
export async function readLink(url, codes = {}) {
  const r = await call({ action: 'page', url, article_code: codes.article_code || '', color_code: codes.color_code || '' }, 60000)
  r.candidates = (r.candidates || []).filter((c) => c && c.url)
  return r
}

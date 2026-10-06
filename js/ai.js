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

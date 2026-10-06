// Dati trovati online → campi del capo. Logica pura, condivisa da scheda capo, negozio e raffica.
// Regole: l'etichetta prevale (composizione, taglia); il web completa ciò che manca
// (nome del modello, colore, categoria, prezzo di listino) e porta la foto di catalogo.
import { CATEGORIES, colorFromName, categoryFromText, fiberToItalian, textToComposition, fabricFromComposition } from './taxonomy.js'

const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)

// Testo per l'utente sul risultato complessivo della ricerca
export const LEVEL_TEXT = {
  exact: 'Corrisponde: modello e colore',
  model: 'Modello trovato, colore da confermare',
  possible: 'Non identificato con certezza',
  none: 'Non trovato online',
}

export function variantOf(cand, i) {
  return i >= 0 ? cand?.variants?.[i] || null : null
}

// Nome del modello ripulito dal nome del negozio e della marca
export function modelName(cand, brand) {
  let t = String(cand?.title || '').replace(/[®™©]/g, '').split(/\s\|\s/)[0].trim()
  if (brand) t = t.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–:]?\\s*`, 'i'), '')
  t = t.replace(/\s+/g, ' ').trim()
  if (t === t.toUpperCase() && t.length > 3) t = t.charAt(0) + t.slice(1).toLowerCase()
  return t.length >= 3 && t.length <= 60 ? t : null
}

// Composizione dal campo "material" della pagina, es. "100% Cotton" o "Cotone 98%, Elastan 2%"
export function compositionFromWeb(material) {
  const comp = textToComposition(material).map((c) => ({ fiber: fiberToItalian(c.fiber), pct: c.pct }))
  const tot = comp.reduce((a, c) => a + c.pct, 0)
  return comp.length && tot >= 95 && tot <= 105 ? comp : []
}

// Valori proposti dal web per un candidato e (facoltativa) una variante.
// matchLevel: 'exact' | 'model' | 'chosen' — cosa verrà salvato nel capo.
export function webFields(cand, variantIdx, { brand, matchLevel } = {}) {
  const v = variantOf(cand, variantIdx)
  const colorName = v?.color || (cand.variants?.length > 1 ? '' : cand.color)
  const composition = compositionFromWeb(cand.material)
  return {
    fields: {
      brand: cand.brand ? cand.brand.replace(/[®™©]/g, '').trim().slice(0, 40) || null : null,
      color_primary: colorFromName(colorName),
      name: modelName(cand, brand || cand.brand),
      category: categoryFromText(`${cand.title} ${cand.url}`),
      composition,
      fabric: fabricFromComposition(composition),
      list_price: cand.price && (!cand.currency || cand.currency === 'EUR') ? Math.round(cand.price * 100) / 100 : null,
      source_url: v?.url || cand.url,
      match_level: matchLevel,
    },
    colorName,
    imageUrl: v?.image || cand.image || null,
  }
}

// Unisce i valori web nella bozza senza toccare ciò che hai scritto tu o che viene dall'etichetta.
// protect(k) → true se il campo non va toccato (es. modificato a mano). Restituisce le chiavi cambiate.
export function mergeInto(draft, fields, { protect = () => false, labelWins = ['composition', 'fabric', 'size_label', 'size_system'] } = {}) {
  const changed = []
  for (const [k, v] of Object.entries(fields)) {
    if (empty(v)) continue
    if (labelWins.includes(k) && !empty(draft[k])) continue
    if (protect(k)) continue
    if (['source_url', 'match_level', 'list_price'].includes(k) || empty(draft[k])) {
      draft[k] = v; changed.push(k)
    }
  }
  if (changed.includes('category') && draft.category) draft.kind = CATEGORIES[draft.category]?.kind || draft.kind
  return changed
}

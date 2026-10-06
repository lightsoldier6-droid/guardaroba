// Valutazione di un capo in negozio. Funzioni pure.
import { CATEGORIES, COLORS, SEASONS, OCCASIONS } from './taxonomy.js'
import { outfitsWith, slotOf, itemName, toDay, daysBetween } from './outfit.js'
import { recommendSize } from './sizes.js'

const ALL_SEASONS = Object.keys(SEASONS)
const OCC_SHARE = { formal: 0.12, work: 0.45, casual: 0.55, sport: 0.2 } // quota dei giorni in cui serve
const SLOT_USE = { top: 1, bottom: 1, shoes: 1, mid: 0.55, jacket: 0.7, outer: 0.6, suit: 0.5, belt: 0.8 }

// Capi duplicati o simili
export function duplicates(candidate, items) {
  const slot = slotOf(candidate)
  const seasons = candidate.seasons?.length ? candidate.seasons : ALL_SEASONS
  const same = [], similar = []
  for (const it of items) {
    if (it.archived || slotOf(it) !== slot) continue
    const overlap = !it.seasons?.length || it.seasons.some((s) => seasons.includes(s))
    if (!overlap) continue
    const sameColor = it.color_primary && it.color_primary === candidate.color_primary
    const fabricDiffers = it.fabric && candidate.fabric && it.fabric !== candidate.fabric
    if (it.category === candidate.category && sameColor && !fabricDiffers) same.push(it)
    else if (sameColor || (it.category === candidate.category && COLORS[it.color_primary]?.neutral && COLORS[candidate.color_primary]?.neutral
      && Math.abs(COLORS[it.color_primary].l - COLORS[candidate.color_primary].l) < 0.15)) similar.push(it)
  }
  return { same, similar }
}

// Buchi: combinazioni stagione×occasione coperte dal candidato in cui hai ≤1 capo nello stesso ruolo
export function gaps(candidate, items) {
  const slot = slotOf(candidate)
  const seasons = candidate.seasons?.length ? candidate.seasons : ALL_SEASONS
  const occs = candidate.occasions?.length ? candidate.occasions : ['casual']
  const cells = []
  for (const s of seasons) for (const o of occs) {
    const n = items.filter((it) => !it.archived && slotOf(it) === slot
      && (!it.seasons?.length || it.seasons.includes(s))
      && (it.occasions?.length ? it.occasions.includes(o) : o === 'casual')).length
    cells.push({ season: s, occasion: o, n })
  }
  return cells
}

// Stima utilizzi/anno e costo per utilizzo
export function costPerUse(candidate, items, wearLog, today = new Date()) {
  const cat = CATEGORIES[candidate.category]
  const slot = slotOf(candidate)
  const seasons = candidate.seasons?.length ? candidate.seasons : ALL_SEASONS
  const occs = candidate.occasions?.length ? candidate.occasions : ['casual']
  const competitors = items.filter((it) => !it.archived && slotOf(it) === slot
    && (!it.seasons?.length || it.seasons.some((s) => seasons.includes(s)))
    && (!it.occasions?.length || it.occasions.some((o) => occs.includes(o)))).length

  // Se il registro copre almeno 30 giorni, usa i dati reali di quel ruolo
  let perYear = null, basis = 'stima'
  const logs = wearLog || []
  if (logs.length) {
    const first = logs.reduce((m, w) => (w.worn_on < m ? w.worn_on : m), logs[0].worn_on)
    const span = daysBetween(first, toDay(today)) + 1
    const slotIds = new Set(items.filter((it) => slotOf(it) === slot).map((it) => it.id))
    const slotDays = logs.filter((w) => slotIds.has(w.item_id)).length
    if (span >= 30 && slotDays >= 10) {
      perYear = (slotDays / span) * 365 * (seasons.length / 4) / (competitors + 1)
      basis = 'registro'
    }
  }
  if (perYear == null) {
    const share = Math.min(0.9, occs.reduce((s, o) => s + (OCC_SHARE[o] || 0.3), 0))
    perYear = seasons.length * 91 * share * (SLOT_USE[slot] || 0.6) / (competitors + 1)
  }
  perYear = Math.max(2, Math.min(150, perYear))
  const years = cat?.life || 3
  const uses = Math.round(perYear * years)
  const price = Number(candidate.price) || 0
  return { perYear: Math.round(perYear), years, uses, cpu: price ? price / uses : null, basis, competitors }
}

export function evaluate({ candidate, items, wearLog, measures, guide, today = new Date() }) {
  items = (items || []).filter((i) => !i.archived)
  const reasons = []
  const unlocked = outfitsWith(candidate, items)
  const dup = duplicates(candidate, items)
  const gapCells = gaps(candidate, items)
  const cpu = costPerUse(candidate, items, wearLog, today)
  const size = recommendSize({ category: candidate.category, brand: candidate.brand, system: candidate.size_system, items, measures, guide })

  const seasons = candidate.seasons?.length ? candidate.seasons : []
  const occs = candidate.occasions?.length ? candidate.occasions : []

  // Componenti 0..1
  const sUnlock = Math.min(1, Math.log1p(unlocked.count) / Math.log1p(30))
  const sCover = (seasons.length / 4 + occs.length / 4) / 2
  const holes = gapCells.filter((c) => c.n === 0).length, thin = gapCells.filter((c) => c.n === 1).length
  const sGap = gapCells.length ? (holes + 0.5 * thin) / gapCells.length : 0
  const sNeed = Math.max(0, Math.min(1, 0.4 + 0.6 * sGap - 0.35 * dup.same.length - 0.12 * dup.similar.length))
  let sCost = null
  if (cpu.cpu != null) sCost = cpu.cpu <= 1 ? 1 : cpu.cpu <= 3 ? 0.8 : cpu.cpu <= 6 ? 0.55 : cpu.cpu <= 12 ? 0.3 : 0.1

  const parts = [[sUnlock, 35], [sNeed, 30], [sCover, 15]]
  if (sCost != null) parts.push([sCost, 20])
  const tot = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0)
  let score = Math.round(tot * 100)
  if (dup.same.length && holes === 0) score = Math.min(score, 55)
  if (unlocked.count === 0) score = Math.min(score, 35)

  const verdict = score >= 68 ? 'buy' : score >= 45 ? 'consider' : 'skip'

  // Ragioni in chiaro
  reasons.push({ key: 'unlock', text: unlocked.count === 0 ? 'Non forma outfit validi con ciò che hai' : `${unlocked.count} ${unlocked.count === 1 ? 'outfit nuovo valido' : 'outfit nuovi validi'} con ciò che possiedi`, good: unlocked.count >= 8 })
  reasons.push({ key: 'cover', text: `Copre ${seasons.length || 0} ${seasons.length === 1 ? 'stagione' : 'stagioni'} e ${occs.length || 0} ${occs.length === 1 ? 'occasione' : 'occasioni'}`
    + (seasons.length ? ` (${seasons.map((s) => SEASONS[s].toLowerCase()).join(', ')}; ${occs.map((o) => OCCASIONS[o].toLowerCase()).join(', ') || '—'})` : ''), good: sCover >= 0.5 })
  if (dup.same.length) reasons.push({ key: 'dup', text: `Doppione: hai già ${dup.same.length} ${dup.same.length === 1 ? 'capo uguale' : 'capi uguali'} per tipo e colore`, good: false, items: dup.same })
  else if (dup.similar.length) reasons.push({ key: 'dup', text: `Simile a ${dup.similar.length} ${dup.similar.length === 1 ? 'capo' : 'capi'} che hai già`, good: false, items: dup.similar })
  if (holes) reasons.push({ key: 'gap', text: `Riempie un vuoto: ${holes} ${holes === 1 ? 'combinazione' : 'combinazioni'} stagione/occasione senza nulla di simile`, good: true })
  else if (thin) reasons.push({ key: 'gap', text: `Rinforza ${thin} ${thin === 1 ? 'combinazione' : 'combinazioni'} dove hai un solo capo`, good: true })
  else if (!dup.same.length) reasons.push({ key: 'gap', text: 'Nessun vuoto da riempire: in quel ruolo sei già coperto', good: false })
  reasons.push({ key: 'cpu', text: cpu.cpu != null
    ? `Circa ${fmtEur(cpu.cpu)} a utilizzo (≈${cpu.perYear} usi/anno per ${cpu.years} anni, ${cpu.basis === 'registro' ? 'dal tuo registro' : 'stima'})`
    : `≈${cpu.perYear} usi/anno stimati: indica il prezzo per il costo per utilizzo`, good: sCost != null ? sCost >= 0.55 : null })

  return { score, verdict, sentence: sentence(verdict, { unlocked, dup, holes, thin, cpu, candidate }), reasons, unlocked, dup, gapCells, cpu, size }
}

export const fmtEur = (v) => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: v < 10 ? 2 : 0 })

function sentence(v, { unlocked, dup, holes, cpu }) {
  const n = unlocked.count
  const cost = cpu.cpu != null ? `, circa ${fmtEur(cpu.cpu)} a utilizzo` : ''
  if (v === 'buy') return `Compralo: ${n} outfit nuovi${holes ? ' e riempie un vuoto' : ''}${cost}.`
  if (v === 'consider') {
    if (dup.same.length) return `Valuta: è un doppione di ${itemName(dup.same[0]).toLowerCase()}, compralo solo se lo sostituisce.`
    return `Valuta: utile ma non indispensabile (${n} outfit${cost}).`
  }
  if (dup.same.length) return `Lascia perdere: hai già ${itemName(dup.same[0]).toLowerCase()}.`
  if (!n) return 'Lascia perdere: non si abbina a quello che hai.'
  return `Lascia perdere: rende poco rispetto al prezzo${cost}.`
}

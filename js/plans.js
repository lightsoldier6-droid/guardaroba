// Eventi e viaggi: logica pura (nessun DOM, nessuna rete). Usa il motore degli outfit con i dress code.
//  - evento: 3 proposte per il dress code e il meteo del giorno
//  - viaggio: un outfit per giorno con meno capi possibile in valigia (i capi già scelti sono favoriti)
import { suggestOutfits, slotOf } from './outfit.js'
import { DRESS_CODES } from './taxonomy.js'

// prima i giorni più esigenti: la giacca e le scarpe scelte lì si riusano negli altri
const RANK = { formal: 0, smart: 1, business_casual: 2, sport: 3, casual: 4 }
const BULKY = ['shoes', 'jacket', 'outer', 'suit']
const atNoon = (iso) => new Date(iso + 'T12:00:00')

export function eventOutfits({ items, dress, weather, date }) {
  return suggestOutfits({ items, wearLog: [], dress, weather, date: atNoon(date), count: 3, rotationNote: false })
}

// Quante volte si può rimettere la stessa maglia o camicia: mai due giorni di fila, al massimo 2 volte nei viaggi lunghi
const maxTopUses = (n) => (n > 5 ? 2 : 1)

// Candidati per un giorno, dati i capi già in valigia (packed: Map id → usi) e le maglie dei giorni vicini
function candidates({ items, day, weather, packed, topUses, nearTops, n, count = 10 }) {
  const exclude = new Set(nearTops)
  for (const [id, c] of topUses) if (c >= maxTopUses(n)) exclude.add(id)
  const bias = (it) => (packed.has(it.id) ? (slotOf(it) === 'top' ? 0.04 : 0.3) : 0)
  const res = suggestOutfits({ items, wearLog: [], dress: day.dress, weather, date: atNoon(day.date), count, bias, exclude, rotationNote: false })
  return {
    missing: res.missing, need: res.need,
    list: res.outfits.map((o) => {
      const fresh = o.items.filter((it) => !packed.has(it.id))
      const cost = fresh.reduce((s, it) => s + (BULKY.includes(slotOf(it)) ? 0.1 : 0.05), 0)
      return { o, adj: o.raw - cost }
    }).sort((a, b) => b.adj - a.adj),
  }
}

const tally = (outfits, skip = -1) => {
  const packed = new Map(), topUses = new Map()
  outfits.forEach((d, i) => {
    if (!d || i === skip) return
    for (const id of d.items) {
      packed.set(id, (packed.get(id) || 0) + 1)
      if (d.tops?.includes(id)) topUses.set(id, (topUses.get(id) || 0) + 1)
    }
  })
  return { packed, topUses }
}
const topsOf = (o) => o.items.filter((it) => slotOf(it) === 'top').map((it) => it.id)

// Ogni giornata ha l'impegno del giorno e, se c'è, quello della sera (con un outfit a parte)
export const PARTS = { day: 'Giorno', evening: 'Sera' }
export function slotsOf(days) {
  return (days || []).flatMap((d) => [
    { date: d.date, part: 'day', dress: d.dress },
    ...(d.evening ? [{ date: d.date, part: 'evening', dress: d.evening }] : []),
  ])
}
// la sera è più fresca: conta di più la minima
export function eveningWeather(w) {
  if (!w) return w
  const mid = (a, b) => (a != null && b != null ? (a + b) / 2 : a ?? b)
  return { ...w, tmax: mid(w.tmax, w.tmin), feelsMax: mid(w.feelsMax ?? w.tmax, w.feelsMin ?? w.tmin) }
}
const partOf = (o) => o?.part || 'day'
const weatherOf = (slot, weatherByDate) => (slot.part === 'evening' ? eveningWeather(weatherByDate[slot.date]) : weatherByDate[slot.date])
// maglie da evitare: quelle delle giornate vicine e dell'altra parte della stessa giornata (la sera ci si cambia)
const nearTopsOf = (slots, outfits, i) => {
  const d = slots[i].date, prev = shift(d, -1), next = shift(d, 1)
  return outfits.flatMap((o, j) => (j !== i && o && [prev, d, next].includes(o.date) ? o.tops || [] : []))
}
const shift = (iso, n) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const entry = (slot, pick, k = 0) => (pick
  ? { date: slot.date, part: slot.part, dress: slot.dress, items: pick.o.items.map((it) => it.id), tops: topsOf(pick.o), reason: pick.o.reason, alt: k }
  : { date: slot.date, part: slot.part, dress: slot.dress, items: [], tops: [], reason: '', alt: 0 })

// days: [{ date, dress, evening? }], weatherByDate: { data: meteo }. Ritorna un outfit per ogni impegno (slotsOf), nello stesso ordine
export function planTrip({ items, days, weatherByDate = {} }) {
  const slots = slotsOf(days)
  const out = new Array(slots.length).fill(null)
  const order = slots.map((_, i) => i).sort((a, b) => (RANK[slots[a].dress] ?? 5) - (RANK[slots[b].dress] ?? 5) || a - b)
  for (const i of order) {
    const { packed, topUses } = tally(out)
    const c = candidates({ items, day: slots[i], weather: weatherOf(slots[i], weatherByDate), packed, topUses, nearTops: nearTopsOf(slots, out, i), n: days.length })
    out[i] = entry(slots[i], c.list[0])
    if (!c.list[0]) out[i].missing = c.missing
  }
  return out
}

// Altra proposta per l'impegno i, tenendo fermi gli altri (alt = quale alternativa mostrare)
export function alternativeFor({ items, days, outfits, i, weatherByDate = {} }) {
  const slots = slotsOf(days)
  const { packed, topUses } = tally(outfits, i)
  const c = candidates({ items, day: slots[i], weather: weatherOf(slots[i], weatherByDate), packed, topUses, nearTops: nearTopsOf(slots, outfits, i), n: days.length, count: 8 })
  if (!c.list.length) return outfits[i]
  const cur = (outfits[i]?.items || []).join()
  const opts = c.list.filter((x) => x.o.items.map((it) => it.id).join() !== cur)
  if (!opts.length) return outfits[i]
  const k = ((outfits[i]?.alt || 0) + 1) % opts.length
  return entry(slots[i], opts[k] || opts[0], k)
}

// Le proposte salvate valgono ancora se corrispondono, nell'ordine, agli impegni del viaggio
export function outfitsMatch(days, outfits) {
  const slots = slotsOf(days)
  return (outfits || []).length === slots.length && slots.every((s, i) => outfits[i]?.date === s.date && partOf(outfits[i]) === s.part && outfits[i].dress === s.dress)
}

// Valigia: capi distinti con il numero di giorni in cui servono, in ordine di tipo
const SLOT_ORDER = ['suit', 'jacket', 'outer', 'mid', 'top', 'bottom', 'shoes', 'belt']
export function packingList(outfits, items) {
  const byId = new Map(items.map((it) => [it.id, it]))
  const uses = new Map()
  for (const d of outfits || []) for (const id of d?.items || []) uses.set(id, (uses.get(id) || 0) + 1)
  return [...uses].map(([id, n]) => ({ item: byId.get(id), uses: n })).filter((x) => x.item)
    .sort((a, b) => SLOT_ORDER.indexOf(slotOf(a.item)) - SLOT_ORDER.indexOf(slotOf(b.item)) || b.uses - a.uses)
}

export const DRESS_LIST = Object.entries(DRESS_CODES).map(([k, v]) => [k, v.label])

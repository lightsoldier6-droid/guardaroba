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

// days: [{ date, dress }], weatherByDate: { data: meteo }. Ritorna [{ date, dress, items: [id], tops: [id], reason, alt }]
export function planTrip({ items, days, weatherByDate = {} }) {
  const n = days.length
  const out = new Array(n).fill(null)
  const order = days.map((_, i) => i).sort((a, b) => (RANK[days[a].dress] ?? 5) - (RANK[days[b].dress] ?? 5) || a - b)
  for (const i of order) {
    const { packed, topUses } = tally(out)
    const nearTops = [out[i - 1], out[i + 1]].flatMap((d) => d?.tops || [])
    const c = candidates({ items, day: days[i], weather: weatherByDate[days[i].date], packed, topUses, nearTops, n })
    const best = c.list[0]
    out[i] = best
      ? { date: days[i].date, dress: days[i].dress, items: best.o.items.map((it) => it.id), tops: topsOf(best.o), reason: best.o.reason, alt: 0 }
      : { date: days[i].date, dress: days[i].dress, items: [], tops: [], reason: '', alt: 0, missing: c.missing }
  }
  return out
}

// Altra proposta per il giorno i, tenendo fermi gli altri giorni (alt = quale alternativa mostrare)
export function alternativeFor({ items, days, outfits, i, weatherByDate = {} }) {
  const { packed, topUses } = tally(outfits, i)
  const nearTops = [outfits[i - 1], outfits[i + 1]].flatMap((d) => d?.tops || [])
  const c = candidates({ items, day: days[i], weather: weatherByDate[days[i].date], packed, topUses, nearTops, n: days.length, count: 8 })
  if (!c.list.length) return outfits[i]
  const cur = (outfits[i]?.items || []).join()
  const opts = c.list.filter((x) => x.o.items.map((it) => it.id).join() !== cur)
  if (!opts.length) return outfits[i]
  const k = ((outfits[i]?.alt || 0) + 1) % opts.length
  const pick = opts[k] || opts[0]
  return { date: days[i].date, dress: days[i].dress, items: pick.o.items.map((it) => it.id), tops: topsOf(pick.o), reason: pick.o.reason, alt: k }
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

// Motore outfit: funzioni pure (nessun DOM, nessuna rete) — testabili e riusabili.
import { CATEGORIES, COLORS, FABRICS, BROWNS, PATTERN_INFO, seasonOfDate, colorAdj, patternAdj } from './taxonomy.js'

const DAY = 86400000
export const toDay = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10))
export const daysBetween = (a, b) => Math.round((Date.parse(toDay(b)) - Date.parse(toDay(a))) / DAY)

export const slotOf = (item) => CATEGORIES[item?.category]?.slot || null

// Completo → due pezzi virtuali (giacca e pantaloni) con lo stesso id: si combinano tra loro (completo)
// o con altri capi (spezzato). _suit indica il completo di provenienza.
export function suitParts(it) {
  return {
    jacket: { ...it, category: 'blazer', _suit: it.id, _orig: it },
    bottom: { ...it, category: 'trousers', _suit: it.id, _orig: it, warmth: null },
  }
}
const orig = (x) => x?._orig || x
const isFullSuit = (o) => !!(o.jacket?._suit && o.jacket._suit === o.bottom?._suit)

// Cintura e scarpe: stessa famiglia di colore (nero con nero, marroni con marroni)
const LEATHER = { black: 'black', charcoal: 'black', beige: 'brown', cream: 'brown', khaki: 'brown', ...Object.fromEntries(BROWNS.map((c) => [c, 'brown'])) }
export function beltFit(belt, shoes) {
  if (!belt || !shoes) return 0
  const a = LEATHER[belt.color_primary], b = LEATHER[shoes.color_primary]
  if (a && b) return a === b ? 1 : -1
  return 0 // cinture colorate o scarpe di tela: neutro
}
const BELT_BOTTOMS = ['trousers', 'jeans']
export const warmthOf = (item) => {
  if (item?.warmth) return item.warmth
  const base = CATEGORIES[item?.category]?.warmth || 2
  return Math.max(1, Math.min(3, base + (FABRICS[item?.fabric]?.warmth || 0)))
}

export function itemName(item) {
  if (item?.name) return item.name
  const cat = CATEGORIES[item?.category]?.label || 'Capo'
  const col = colorAdj(item?.color_primary, item?.category)
  const pat = patternAdj(item?.pattern, item?.category)
  // con una fantasia evidente conta anche il secondo colore: "Camicia rigata bianca e blu"
  const sec = pat && col && (PATTERN_INFO[item.pattern]?.weight || 0) >= 0.7 ? colorAdj((item.colors_secondary || []).find((c) => c !== item.color_primary), item.category) : ''
  return [cat, pat, sec ? `${col} e ${sec}` : col].filter(Boolean).join(' ')
}

// ---------- Rotazione ------------------------------------------------
export function wearStats(wearLog) {
  const m = new Map()
  for (const w of wearLog || []) {
    const s = m.get(w.item_id) || { count: 0, last: null, days: [] }
    s.count++
    s.days.push(w.worn_on)
    if (!s.last || w.worn_on > s.last) s.last = w.worn_on
    m.set(w.item_id, s)
  }
  return m
}

// 0 = indossato ieri, 1 = trascurato da un mese o mai indossato
export function rotationScore(stat, today) {
  if (!stat || !stat.last) return 1
  const d = daysBetween(stat.last, today)
  if (d <= 1) return 0.05
  if (d <= 3) return 0.3
  return Math.min(1, 0.4 + (d / 30) * 0.6)
}

// ---------- Meteo → bisogni ------------------------------------------
// w: { tmax, tmin, feelsMax, feelsMin, rainProb, rainMm, windMax }
export function weatherNeeds(w, date = new Date()) {
  if (!w) {
    const fallback = { winter: 8, spring: 17, summer: 27, autumn: 16 }[seasonOfDate(date)]
    return { T: fallback, target: targetWarmth(fallback), rain: false, wind: false, known: false }
  }
  const hi = w.feelsMax ?? w.tmax, lo = w.feelsMin ?? w.tmin
  const T = (hi * 2 + lo) / 3 // temperatura percepita nelle ore di giorno
  return {
    T, target: targetWarmth(T),
    rain: (w.rainProb ?? 0) >= 50 || (w.rainMm ?? 0) >= 1.5,
    wind: (w.windMax ?? 0) >= 30,
    known: true,
  }
}
export function targetWarmth(T) {
  if (T >= 24) return 1
  if (T >= 19) return 2
  if (T >= 14) return 3
  if (T >= 9) return 4.5
  if (T >= 4) return 6
  return 7.5
}

// ---------- Armonia cromatica ----------------------------------------
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

export function harmonyScore(o) {
  const parts = ['top', 'mid', 'jacket', 'outer', 'bottom', 'shoes'].map((k) => o[k]).filter(Boolean)
    .filter((p, i, a) => !p._suit || a.findIndex((q) => q._suit === p._suit) === i) // un completo conta una volta sola
  const prim = parts.map((i) => i.color_primary).filter((c) => COLORS[c])
  const accents = [...new Set(prim.filter((c) => !COLORS[c].neutral))]
  let s
  if (accents.length === 0) s = 0.85
  else if (accents.length === 1) s = 1
  else if (accents.length === 2) {
    const [a, b] = accents.map((c) => COLORS[c])
    const d = hueDist(a.hue, b.hue)
    const valueContrast = Math.abs(a.l - b.l) >= 0.4 // uno chiaro e uno scuro reggono meglio
    s = d <= 45 || Math.abs(d - 180) <= 30 ? 0.85 : (a.soft && b.soft) || valueContrast ? 0.72 : 0.5
  } else s = 0.3
  // colori secondari accesi aggiungono rumore
  const secAccents = new Set(parts.flatMap((i) => i.colors_secondary || []).filter((c) => COLORS[c] && !COLORS[c].neutral && !accents.includes(c)))
  if (accents.length + secAccents.size > 2) s -= 0.05 * (accents.length + secAccents.size - 2)

  const top = o.top?.color_primary, bot = o.bottom?.color_primary, shoes = o.shoes?.color_primary
  const jacket = o.jacket?.color_primary
  const near = [[top, bot], [jacket, bot], [o.mid?.color_primary, bot]]
  if (near.some(([x, y]) => (x === 'black' && y === 'navy') || (x === 'navy' && y === 'black'))) s -= 0.12
  if (bot === 'black' && BROWNS.includes(shoes)) s -= 0.15
  if (shoes === 'black' && [...BROWNS, 'beige', 'cream', 'khaki'].includes(bot) && bot !== 'dark_brown') s -= 0.08
  // marroni molto vicini tra loro (es. cacao e testa di moro) sopra e sotto: sembrano un completo sbagliato
  if (BROWNS.includes(top) && BROWNS.includes(bot) && top !== bot && Math.abs(COLORS[top].l - COLORS[bot].l) < 0.1) s -= 0.06
  const isSuit = isFullSuit(o) || (jacket && jacket === bot)
  if (top && bot && top === bot && !isSuit && top !== 'denim') s -= 0.1
  if (isFullSuit(o)) s += 0.08
  else if (isSuit) s += 0.05
  else if (o.jacket?._suit || o.bottom?._suit) s -= 0.03 // spezzato: si fa, ma va dosato
  // fantasie: una sola fantasia evidente per outfit. Conta quanto si notano le altre oltre la più forte
  // (righe con quadri stona; un pantalone spigato sotto una camicia rigata quasi non pesa)
  const pw = parts.map((p) => PATTERN_INFO[p.pattern]?.weight || 0).filter((w) => w > 0)
  if (pw.length >= 2) s -= 0.12 * (pw.reduce((a, b) => a + b, 0) - Math.max(...pw))
  const bf = beltFit(o.belt, o.shoes)
  if (bf > 0) s += 0.04
  if (bf < 0) s -= 0.12
  if (COLORS[top] && COLORS[bot] && Math.abs(COLORS[top].l - COLORS[bot].l) >= 0.2) s += 0.05
  return Math.max(0, Math.min(1, s))
}

// ---------- Filtri di idoneità ---------------------------------------
export function fitsOccasion(item, occ) {
  const occs = item.occasions || []
  if (!occs.length) return occ === 'casual'
  if (!occs.includes(occ)) return false
  if ((occ === 'formal' || occ === 'work') && ['shorts', 'sandals'].includes(item.category)) return false
  return true
}
// Polo segnata solo Casual: per il lavoro informale va bene, ma solo sotto una giacca sartoriale
export function onlyUnderJacket(item, occ) {
  return occ === 'work' && !!CATEGORIES[item?.category]?.underJacket && !fitsOccasion(item, occ) && fitsOccasion(item, 'casual')
}
const isPolo = (it) => !!CATEGORIES[it?.category]?.underJacket
export function seasonScore(item, season) {
  const s = item.seasons || []
  if (!s.length) return 0.7
  return s.includes(season) ? 1 : 0.35
}
function weatherAllows(item, need) {
  const c = item.category, T = need.T
  if (c === 'shorts' && T < 19) return false
  if (c === 'sandals' && (T < 19 || need.rain)) return false
  const fab = FABRICS[item.fabric]
  if (fab?.noCold && T < 15) return false // lino con il freddo
  if (fab?.noHeat && T >= 26 && CATEGORIES[c]?.slot !== 'shoes') return false // lana e cashmere con il caldo
  if (c === 'coat' && T >= 18) return false
  if (c === 'boots' && T >= 24) return false
  if (T >= 26 && ['knit', 'sweatshirt', 'jacket', 'coat'].includes(c)) return false
  if (CATEGORIES[c]?.slot === 'outer' && T >= 22 && !need.rain) return false
  return true
}

// ---------- Generazione outfit ---------------------------------------
const KEYS = ['top', 'mid', 'jacket', 'outer', 'bottom', 'shoes']
const SHOW = ['top', 'mid', 'jacket', 'outer', 'bottom', 'belt', 'shoes']
const LIMIT = { top: 6, bottom: 6, shoes: 5, mid: 4, jacket: 4, outer: 4, belt: 4 }

export function suggestOutfits({ items, wearLog, occasion, weather, date = new Date(), count = 3 }) {
  const today = toDay(date)
  const season = seasonOfDate(date)
  const need = weatherNeeds(weather, date)
  const stats = wearStats(wearLog)
  const scored = new Map()

  const pools = Object.fromEntries([...KEYS, 'belt'].map((k) => [k, []]))
  const jacketOnly = [] // polo casual: entrano solo con la giacca
  for (const it of items || []) {
    if (it.archived) continue
    const slot = slotOf(it)
    const bridged = onlyUnderJacket(it, occasion)
    if (!slot || !(fitsOccasion(it, occasion) || bridged) || !weatherAllows(it, need)) continue
    const rot = rotationScore(stats.get(it.id), today)
    const sc = 0.55 * rot + 0.45 * seasonScore(it, season)
    scored.set(it.id, { sc, rot, stat: stats.get(it.id) })
    if (slot === 'suit') { const p = suitParts(it); pools.jacket.push(p.jacket); pools.bottom.push(p.bottom) }
    else if (bridged) jacketOnly.push(it)
    else pools[slot].push(it)
  }
  for (const k of [...KEYS, 'belt']) pools[k] = pools[k].sort((a, b) => scored.get(b.id).sc - scored.get(a.id).sc).slice(0, LIMIT[k])
  // al massimo due polo "solo con giacca", e solo se una giacca c'è
  const needsJacket = new Set(pools.jacket.length ? jacketOnly.sort((a, b) => scored.get(b.id).sc - scored.get(a.id).sc).slice(0, 2).map((it) => it.id) : [])
  pools.top.push(...jacketOnly.filter((it) => needsJacket.has(it.id)))

  const missing = ['top', 'bottom', 'shoes'].filter((k) => !pools[k].length)
  if (occasion === 'formal' && !pools.jacket.length) missing.push('jacket')
  if (missing.filter((k) => k !== 'jacket').length) return { outfits: [], missing, need }

  const opt = (k, required) => (required && pools[k].length ? pools[k] : [null, ...pools[k]])
  const jackets = opt('jacket', occasion === 'formal')
  const mids = need.T >= 24 ? [null] : opt('mid')
  const outers = opt('outer')

  const all = []
  for (const top of pools.top) for (const bottom of pools.bottom) for (const shoes of pools.shoes)
    for (const mid of mids) for (const jacket of jackets) for (const outer of outers) {
      if (!jacket && needsJacket.has(top.id)) continue
      const o = { top, mid, jacket, outer, bottom, shoes, belt: null }
      // cintura solo con pantaloni o jeans (anche quelli del completo), scelta in tinta con le scarpe
      if (BELT_BOTTOMS.includes(bottom.category) && pools.belt.length) {
        let best = null, bestFit = 0
        for (const b of pools.belt) { const f = beltFit(b, shoes); if (f > bestFit || (f === bestFit && f >= 0 && !best)) { best = b; bestFit = f } }
        if (best && bestFit >= 0) o.belt = best
      }
      const parts = [...KEYS, 'belt'].map((k) => o[k]).filter(Boolean).filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i)
      const warm = warmthOf(top) + (mid ? warmthOf(mid) : 0) + (jacket ? warmthOf(jacket) : 0) + (outer ? warmthOf(outer) : 0)
      const warmthFit = Math.max(0, 1 - Math.abs(warm - need.target) / 3)
      const meanItem = parts.reduce((s, p) => s + scored.get(p.id).sc, 0) / parts.length
      const harmony = harmonyScore(o)
      let bonus = 0
      if (need.rain && outer && ['raincoat', 'jacket'].includes(outer.category)) bonus += 0.08
      if (need.rain && !outer && need.T < 24) bonus -= 0.1
      if (need.rain && FABRICS[shoes.fabric]?.badInRain) bonus -= 0.12
      if (need.wind && outer) bonus += 0.03
      if (occasion === 'work' && jacket) bonus += 0.02
      if (jacket && isPolo(top) && occasion !== 'formal') bonus += 0.03 // polo sotto la giacca: smart casual
      if (occasion === 'formal' && isFullSuit(o)) bonus += 0.03
      if (o.belt && ['formal', 'work'].includes(occasion)) bonus += 0.02
      const score = 0.4 * meanItem + 0.3 * harmony + 0.3 * warmthFit + bonus
      all.push({ o, score, harmony, warmthFit, warm })
    }
  all.sort((a, b) => b.score - a.score)

  const picked = []
  for (const c of all) {
    if (picked.every((p) => KEYS.filter((k) => (p.o[k]?.id || null) !== (c.o[k]?.id || null)).length >= 2)) picked.push(c)
    if (picked.length >= count) break
  }
  // completi: fuori dal formale, se c'è uno spezzato valido quasi quanto le altre proposte, uno lo proponiamo
  const splitOf = (o) => !isFullSuit(o) && (o.jacket?._suit || o.bottom?._suit)
  if (occasion !== 'formal' && picked.length && !picked.some((p) => splitOf(p.o))) {
    const sp = all.find((c) => splitOf(c.o) && c.score >= picked[0].score * 0.85)
    if (sp) picked.length >= count ? (picked[picked.length - 1] = sp) : picked.push(sp)
  }
  return {
    outfits: picked.map((p) => ({
      // un completo indossato intero compare una volta sola; sempre il capo originale (per foto, nome e registro)
      items: SHOW.map((k) => p.o[k]).filter(Boolean).map(orig).filter((it, i, a) => a.findIndex((x) => x.id === it.id) === i),
      slots: p.o,
      suit: isFullSuit(p.o) ? 'full' : (p.o.jacket?._suit || p.o.bottom?._suit) ? 'split' : null,
      score: Math.round(p.score * 100),
      reason: explain(p, need, scored, today),
    })),
    missing, need,
  }
}

function colorName(c) { return (COLORS[c]?.label || '').toLowerCase() }

function explain(p, need, scored, today) {
  const o = p.o
  const bits = []
  if (need.known) {
    let w = `${Math.round(need.T)}° percepiti`
    if (need.rain) w += o.outer && ['raincoat', 'jacket'].includes(o.outer.category) ? ', pioggia: c’è il capospalla giusto' : ', pioggia: porta l’ombrello'
    else if (need.wind) w += ', vento'
    bits.push(w)
  }
  const prim = KEYS.map((k) => o[k]?.color_primary).filter((c) => COLORS[c])
  const accents = [...new Set(prim.filter((c) => !COLORS[c].neutral))]
  const neutrals = [...new Set(prim.filter((c) => COLORS[c].neutral))]
  if (isFullSuit(o)) bits.push('completo intero')
  else if (o.jacket?._suit) bits.push('spezzato: giacca del completo con altri pantaloni')
  else if (o.bottom?._suit) bits.push('spezzato: pantaloni del completo con un’altra giacca')
  if (o.jacket && isPolo(o.top)) bits.push('polo sotto la giacca')
  if (o.belt) bits.push(beltFit(o.belt, o.shoes) > 0 ? 'cintura in tinta con le scarpe' : 'con cintura')
  if (accents.length === 0) bits.push(`neutri (${neutrals.slice(0, 2).map(colorName).join(' e ')})`)
  else if (accents.length === 1) bits.push(`${colorName(accents[0])} come unico accento`)
  else bits.push(`${accents.map(colorName).join(' e ')} insieme`)
  let best = null
  for (const it of KEYS.map((k) => o[k]).filter(Boolean).map(orig)) {
    const st = scored.get(it.id).stat
    const days = st?.last ? daysBetween(st.last, today) : Infinity
    if (!best || days > best.days) best = { it, days }
  }
  if (best) {
    const n = itemName(best.it).toLowerCase()
    if (best.days === Infinity) bits.push(`prima uscita per ${n}`)
    else if (best.days >= 10) bits.push(`${best.days} giorni dall’ultima volta per ${n}`)
  }
  const s = bits.join('; ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

// ---------- Per la modalità shopping: outfit validi sbloccati --------
export function outfitsWith(candidate, items, { minHarmony = 0.6, maxPool = 30 } = {}) {
  const slot = slotOf(candidate)
  if (!slot) return { count: 0, examples: [] }
  if (slot === 'belt') return beltOutfits(candidate, items)
  const candParts = slot === 'suit' ? suitParts({ ...candidate, id: candidate.id || '__cand' }) : null
  const seasons = candidate.seasons?.length ? candidate.seasons : ['spring', 'summer', 'autumn', 'winter']
  let occs = candidate.occasions?.length ? candidate.occasions : ['casual']
  if (onlyUnderJacket(candidate, 'work')) occs = [...occs, 'work']
  const seen = new Map()
  for (const season of seasons) for (const occ of occs) {
    const pool = { top: [], bottom: [], shoes: [], jacket: [] }
    for (const it of items) {
      if (it.archived || it.id === candidate.id) continue
      const s = slotOf(it)
      if (!fitsOccasion(it, occ) && !onlyUnderJacket(it, occ)) continue
      if (it.seasons?.length && !it.seasons.includes(season)) continue
      if (s === 'suit') { const p = suitParts(it); pool.jacket.push(p.jacket); pool.bottom.push(p.bottom); continue }
      if (!(s in pool)) continue
      pool[s].push(it)
    }
    for (const k in pool) pool[k] = pool[k].slice(0, maxPool)
    const base = ['top', 'bottom', 'shoes']
    const fill = (k) => (candParts && k === 'bottom' ? [candParts.bottom] : k === slot ? [candidate] : pool[k])
    const needJacket = occ === 'formal' && slot !== 'jacket' && slot !== 'suit'
    if (needJacket && !pool.jacket.length) continue
    for (const top of fill('top')) for (const bottom of fill('bottom')) for (const shoes of fill('shoes')) {
      const o = { top, bottom, shoes }
      if (candParts) o.jacket = candParts.jacket
      else if (!base.includes(slot)) o[slot] = candidate
      const reqJacket = needJacket || (!o.jacket && onlyUnderJacket(top, occ))
      if (reqJacket && !pool.jacket.length) continue
      let h = harmonyScore(o)
      if (reqJacket) h = Math.max(...pool.jacket.map((j) => harmonyScore({ ...o, jacket: j })))
      if (h < minHarmony) continue
      const key = [top.id, bottom.id, shoes.id].join('|')
      const prev = seen.get(key)
      if (!prev || prev.h < h) seen.set(key, { o, h })
    }
  }
  const examples = [...seen.values()].sort((a, b) => b.h - a.h).slice(0, 3)
    .map((x) => ['top', 'bottom', 'shoes'].map((k) => x.o[k]).filter((i) => i !== candidate && !(candParts && i._suit === candParts.bottom._suit)).map(orig))
  return { count: seen.size, examples }
}

// Una cintura "sblocca" le combinazioni pantaloni + scarpe in cui sta bene con le scarpe
function beltOutfits(belt, items) {
  const bottoms = [], shoes = []
  for (const it of items) {
    if (it.archived) continue
    const s = slotOf(it)
    if (s === 'suit') bottoms.push(suitParts(it).bottom)
    else if (s === 'bottom' && BELT_BOTTOMS.includes(it.category)) bottoms.push(it)
    else if (s === 'shoes') shoes.push(it)
  }
  const ok = []
  for (const b of bottoms) for (const sh of shoes) if (beltFit(belt, sh) >= 0 && harmonyScore({ bottom: b, shoes: sh, belt }) >= 0.6) ok.push([b, sh])
  return { count: ok.length, examples: ok.slice(0, 3).map((x) => x.map(orig)) }
}

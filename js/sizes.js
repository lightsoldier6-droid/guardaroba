// Taglie: riferimento personale per categoria e sistema, eccezioni per marca,
// raccomandazione in negozio. Funzioni pure.
import { CATEGORIES } from './taxonomy.js'

export const GROUPS = ['shirts', 'jackets', 'trousers', 'knit', 'shoes']
export const SYSTEMS = ['IT', 'EU', 'UK', 'US', 'LETTER']
const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']

const STEP = {
  shirts:   { IT: 1, EU: 1, UK: 0.5, US: 0.5 },
  jackets:  { IT: 2, EU: 2, UK: 2, US: 2 },
  knit:     { IT: 2, EU: 2, UK: 2, US: 2 },
  trousers: { IT: 2, EU: 2, UK: 1, US: 1 },
  shoes:    { IT: 1, EU: 1, UK: 0.5, US: 0.5 },
}

export function normLetter(s) {
  let t = String(s || '').toUpperCase().replace(/\s+/g, '')
  t = t.replace(/^XXXXL$/, '4XL').replace(/^XXXL$/, '3XL').replace(/^2XL$/, 'XXL').replace(/^2XS$/, 'XXS')
  return LETTERS.includes(t) ? t : null
}

// Restituisce una chiave canonica confrontabile per gruppo/sistema
export function canonical(label, system, group) {
  if (label == null || label === '') return null
  if (system === 'LETTER') return normLetter(label)
  const s = String(label).toUpperCase().replace(',', '.')
  if (group === 'trousers' && (system === 'US' || system === 'UK')) {
    const w = s.match(/W?\s*(\d{2})/)
    return w ? `W${w[1]}` : null
  }
  const n = s.match(/\d+(?:\.\d+)?/)
  return n ? String(parseFloat(n[0])) : null
}

export function stepSize(label, system, group, delta) {
  if (!delta) return label
  if (system === 'LETTER') {
    const i = LETTERS.indexOf(normLetter(label))
    return i < 0 ? label : LETTERS[Math.max(0, Math.min(LETTERS.length - 1, i + delta))]
  }
  if (group === 'trousers' && (system === 'US' || system === 'UK')) {
    const w = String(label).match(/\d{2}/)
    return w ? `W${parseInt(w[0], 10) + delta}` : label
  }
  const n = parseFloat(String(label).replace(',', '.'))
  if (!isFinite(n)) return label
  return String(n + delta * (STEP[group]?.[system] || 1))
}

const FEEL_DELTA = { tight: 1, right: 0, loose: -1 }

// ---------- Dalle misure ---------------------------------------------
const even = (x) => Math.round(x / 2) * 2
const half = (x) => Math.round(x * 2) / 2
const inch = (cm) => cm / 2.54

export function letterFromChest(c) {
  if (!c) return null
  const t = [[88, 'XS'], [96, 'S'], [104, 'M'], [112, 'L'], [120, 'XL'], [128, 'XXL']]
  for (const [lim, l] of t) if (c < lim) return l
  return '3XL'
}
export function letterFromWaist(w) {
  if (!w) return null
  const t = [[74, 'XS'], [82, 'S'], [90, 'M'], [98, 'L'], [106, 'XL'], [114, 'XXL']]
  for (const [lim, l] of t) if (w < lim) return l
  return '3XL'
}

export function fromMeasures(m) {
  const out = Object.fromEntries(GROUPS.map((g) => [g, {}]))
  if (!m) return out
  const num = (k) => (m[k] == null || m[k] === '' ? null : Number(m[k]))
  const neck = num('neck_cm'), chest = num('chest_cm'), waist = num('waist_cm'), inseam = num('inseam_cm'), foot = num('foot_length_cm')
  if (neck) {
    const collar = Math.round(neck + 1)
    out.shirts.IT = out.shirts.EU = String(collar)
    out.shirts.UK = out.shirts.US = String(half(inch(collar)))
  }
  if (chest) {
    out.shirts.LETTER = letterFromChest(chest)
    out.jackets.IT = out.jackets.EU = String(even(chest / 2))
    out.jackets.UK = out.jackets.US = String(even(inch(chest)))
    out.jackets.LETTER = letterFromChest(chest)
    out.knit.IT = out.knit.EU = String(even(chest / 2))
    out.knit.UK = out.knit.US = String(even(inch(chest)))
    out.knit.LETTER = letterFromChest(chest)
  }
  if (waist) {
    out.trousers.IT = out.trousers.EU = String(even(waist / 2 + 6))
    out.trousers.UK = out.trousers.US = `W${Math.round(inch(waist))}` + (inseam ? ` L${Math.round(inch(inseam))}` : '')
    out.trousers.LETTER = letterFromWaist(waist)
  }
  // Scarpe: prima i numeri inseriti a mano, poi la stima dalla lunghezza del piede
  let eu = num('shoe_eu') ?? num('shoe_it')
  if (!eu && foot) eu = Math.round((foot + 1.5) * 1.5)
  if (eu) {
    out.shoes.EU = String(num('shoe_eu') ?? eu)
    out.shoes.IT = String(num('shoe_it') ?? eu)
    out.shoes.UK = String(num('shoe_uk') ?? half(eu - 34))
    out.shoes.US = String(num('shoe_us') ?? half(eu - 33))
  }
  return out
}

// ---------- Dal guardaroba (capi con "come ti veste") -----------------
// Per ogni capo: taglia ideale = taglia indossata corretta da stretto (+1) / largo (−1)
export function observations(items) {
  const obs = []
  for (const it of items || []) {
    const group = CATEGORIES[it.category]?.group
    if (!group || !it.fit_feel || !(it.fit_feel in FEEL_DELTA)) continue
    const sizes = [{ system: it.size_system, label: it.size_label }, ...(it.size_alt || [])]
    for (const s of sizes) {
      if (!s?.system || !s?.label || !SYSTEMS.includes(s.system)) continue
      const ideal = canonical(stepSize(s.label, s.system, group, FEEL_DELTA[it.fit_feel]), s.system, group)
      if (ideal) obs.push({ group, system: s.system, ideal, brand: normBrand(it.brand), item: it })
    }
  }
  return obs
}

export const normBrand = (b) => (b ? String(b).trim().toLowerCase() : '')

function mode(list) {
  const c = new Map()
  for (const x of list) c.set(x, (c.get(x) || 0) + 1)
  let best = null, n = 0
  for (const [k, v] of c) if (v > n) { best = k; n = v }
  return { value: best, n, total: list.length, agree: n === list.length }
}

// Tabella di riferimento: per gruppo e sistema → { value, source, n }
export function referenceTable(items, measures) {
  const calc = fromMeasures(measures)
  const obs = observations(items)
  const table = {}
  for (const g of GROUPS) {
    table[g] = {}
    for (const s of SYSTEMS) {
      const o = obs.filter((x) => x.group === g && x.system === s).map((x) => x.ideal)
      if (o.length) {
        const m = mode(o)
        table[g][s] = { value: displaySize(m.value, s), source: 'wardrobe', n: o.length }
      } else if (calc[g][s]) {
        table[g][s] = { value: calc[g][s], source: 'measures', n: 0 }
      } else table[g][s] = null
    }
  }
  return table
}

export function displaySize(v, system) {
  return system === 'LETTER' ? v : String(v)
}

export function brandExceptions(items, measures) {
  const obs = observations(items).filter((x) => x.brand)
  const byKey = new Map()
  for (const o of obs) {
    const k = `${o.brand}|${o.group}|${o.system}`
    if (!byKey.has(k)) byKey.set(k, { brand: o.item.brand.trim(), group: o.group, system: o.system, list: [] })
    byKey.get(k).list.push(o.ideal)
  }
  const out = []
  for (const e of byKey.values()) {
    const m = mode(e.list)
    // confronto con il riferimento calcolato SENZA questa marca
    const others = observations(items).filter((x) => x.group === e.group && x.system === e.system && normBrand(x.item.brand) !== normBrand(e.brand)).map((x) => x.ideal)
    const refValue = others.length ? mode(others).value : fromMeasures(measures)[e.group][e.system]
    if (refValue && canonical(refValue, e.system, e.group) !== m.value) {
      out.push({ brand: e.brand, group: e.group, system: e.system, size: displaySize(m.value, e.system), ref: displaySize(canonical(refValue, e.system, e.group), e.system), n: e.list.length })
    }
  }
  return out.sort((a, b) => a.brand.localeCompare(b.brand))
}

// ---------- Guida taglie del marchio (letta dall'AI) ------------------
const GUIDE_FIELDS = {
  shirts: [['neck', 'neck_cm'], ['chest', 'chest_cm']],
  jackets: [['chest', 'chest_cm']],
  knit: [['chest', 'chest_cm']],
  trousers: [['waist', 'waist_cm'], ['hips', 'hips_cm'], ['inseam', 'inseam_cm']],
  shoes: [['foot', 'foot_length_cm']],
}
export function matchSizeGuide(guide, group, measures) {
  if (!guide?.rows?.length || !measures) return null
  const k = guide.unit === 'inch' ? 2.54 : 1
  let best = null
  for (const row of guide.rows) {
    let pen = 0, used = 0
    for (const [f, mk] of GUIDE_FIELDS[group] || []) {
      const v = Number(measures[mk]); let lo = Number(row[`${f}_min`]) * k, hi = Number(row[`${f}_max`]) * k
      if (!v || (!lo && !hi)) continue
      if (!lo) lo = hi; if (!hi) hi = lo
      used++
      if (v < lo) pen += lo - v
      else if (v > hi) pen += v - hi
    }
    if (!used) continue
    if (!best || pen < best.pen) best = { size: row.size, pen, used }
  }
  return best ? { size: best.size, inRange: best.pen === 0, used: best.used, system: guide.system || null } : null
}

// ---------- Raccomandazione in negozio -------------------------------
// Ritorna { size, system, confidence: 'alta'|'media'|'bassa', reason, alt }
export function recommendSize({ category, brand, system, items, measures, guide }) {
  const group = CATEGORIES[category]?.group
  if (!group) return null
  system = system || (group === 'shoes' ? 'EU' : 'IT')
  const b = normBrand(brand)
  const obs = observations(items)
  // il riferimento generale esclude la marca stessa, così le fonti restano indipendenti
  const ref = referenceTable(b ? (items || []).filter((i) => normBrand(i.brand) !== b) : items, measures)
  const results = []

  // 1. Storico della stessa marca
  if (b) {
    const same = obs.filter((o) => o.brand === b && o.group === group)
    const sameSys = same.filter((o) => o.system === system).map((o) => o.ideal)
    if (sameSys.length) {
      const m = mode(sameSys)
      results.push({ size: displaySize(m.value, system), confidence: m.n >= 2 && m.agree ? 'alta' : 'media',
        reason: `${m.n} ${m.n === 1 ? 'capo' : 'capi'} ${brand} nel guardaroba` + (m.agree ? '' : ' (non tutti concordi)') })
    } else if (same.length) {
      // marca nota in un altro sistema: applica lo scostamento della marca rispetto al tuo riferimento
      const o = same[0]
      const r = ref[group][o.system]
      const refC = r && canonical(r.value, o.system, group)
      if (refC && ref[group][system]) {
        const diff = sizeDiff(o.ideal, refC, o.system, group)
        if (diff != null) {
          const val = stepSize(ref[group][system].value, system, group, diff)
          results.push({ size: displaySize(canonical(val, system, group) || val, system), confidence: 'media',
            reason: `${brand} ti veste ${diff > 0 ? 'più piccolo' : diff < 0 ? 'più grande' : 'come le altre marche'} (dato da taglie ${o.system})` })
        }
      }
    }
  }
  // 2. Guida taglie fotografata
  const g = matchSizeGuide(guide, group, measures)
  if (g) {
    results.push({ size: g.size, system: g.system || system, confidence: g.inRange ? 'media' : 'bassa',
      reason: g.inRange ? 'le tue misure rientrano nella guida taglie del marchio' : 'le tue misure sono al limite della guida taglie' })
  }
  // 3. Riferimento personale
  const r = ref[group][system]
  if (r) {
    results.push({ size: r.value, confidence: r.source === 'wardrobe' ? 'media' : 'bassa',
      reason: r.source === 'wardrobe' ? `la tua taglia abituale da ${r.n} ${r.n === 1 ? 'capo' : 'capi'} di altre marche` : 'calcolata dalle tue misure con tabelle standard' })
  }
  if (!results.length) return { size: null, system, confidence: 'bassa', reason: 'Inserisci le misure o indica come ti vestono alcuni capi per avere una taglia.' }

  const top = results[0]
  const sys = top.system || system
  // concordanza tra fonti → alza la fiducia
  const agreeing = results.filter((x) => canonical(x.size, x.system || system, group) === canonical(top.size, sys, group)).length
  let confidence = top.confidence
  if (agreeing >= 2 && confidence !== 'alta') confidence = confidence === 'bassa' ? 'media' : 'alta'
  const disagree = results.find((x) => canonical(x.size, x.system || system, group) !== canonical(top.size, sys, group))
  return {
    size: top.size, system: sys, confidence,
    reason: top.reason + (agreeing >= 2 ? '; confermata da un’altra fonte' : ''),
    alt: disagree ? `${disagree.size} (${disagree.reason})` : null,
  }
}

function sizeDiff(a, b, system, group) {
  if (system === 'LETTER') {
    const i = LETTERS.indexOf(a), j = LETTERS.indexOf(b)
    return i < 0 || j < 0 ? null : i - j
  }
  const na = parseFloat(String(a).replace(/[^\d.]/g, '')), nb = parseFloat(String(b).replace(/[^\d.]/g, ''))
  if (!isFinite(na) || !isFinite(nb)) return null
  const step = group === 'trousers' && (system === 'US' || system === 'UK') ? 1 : (STEP[group]?.[system] || 1)
  return Math.round((na - nb) / step)
}

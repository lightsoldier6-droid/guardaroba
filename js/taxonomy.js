// Vocabolario condiviso: codici stabili (salvati nel database) → etichette italiane.
// Se aggiungi una categoria o un colore, aggiungilo anche in supabase/functions/ai/index.ts.

// slot: dove si colloca il capo in un outfit
//   top = prima pelle sopra; mid = strato intermedio; jacket = giacca sartoriale;
//   outer = capospalla; bottom = sotto; shoes = calzature
// group: gruppo usato per le taglie di riferimento
export const CATEGORIES = {
  shirt:        { label: 'Camicia',            g: 'f', kind: 'garment',  slot: 'top',    group: 'shirts',   warmth: 1, life: 3 },
  tshirt:       { label: 'T-shirt',            g: 'f', kind: 'garment',  slot: 'top',    group: 'knit',     warmth: 1, life: 2 },
  polo:         { label: 'Polo',               g: 'f', kind: 'garment',  slot: 'top',    group: 'knit',     warmth: 1, life: 3 },
  knit:         { label: 'Maglione / cardigan', g: 'm', kind: 'garment', slot: 'mid',    group: 'knit',     warmth: 2, life: 5 },
  sweatshirt:   { label: 'Felpa',              g: 'f', kind: 'garment',  slot: 'mid',    group: 'knit',     warmth: 2, life: 3 },
  vest:         { label: 'Gilet',              g: 'm', kind: 'garment',  slot: 'mid',    group: 'jackets',  warmth: 1, life: 5 },
  blazer:       { label: 'Giacca sartoriale',  g: 'f', kind: 'garment',  slot: 'jacket', group: 'jackets',  warmth: 2, life: 6 },
  jacket:       { label: 'Giubbotto',          g: 'm', kind: 'garment',  slot: 'outer',  group: 'jackets',  warmth: 2, life: 5 },
  coat:         { label: 'Cappotto',           g: 'm', kind: 'garment',  slot: 'outer',  group: 'jackets',  warmth: 3, life: 8 },
  raincoat:     { label: 'Impermeabile',       g: 'm', kind: 'garment',  slot: 'outer',  group: 'jackets',  warmth: 1, life: 6 },
  trousers:     { label: 'Pantaloni',          g: 'm', pl: true, kind: 'garment',  slot: 'bottom', group: 'trousers', warmth: 2, life: 4 },
  jeans:        { label: 'Jeans',              g: 'm', pl: true, kind: 'garment',  slot: 'bottom', group: 'trousers', warmth: 2, life: 4 },
  shorts:       { label: 'Bermuda / shorts',   g: 'm', pl: true, kind: 'garment',  slot: 'bottom', group: 'trousers', warmth: 1, life: 3 },
  shoes_formal: { label: 'Scarpe eleganti',    g: 'f', pl: true, kind: 'footwear', slot: 'shoes',  group: 'shoes',    warmth: 2, life: 6 },
  loafers:      { label: 'Mocassini',          g: 'm', pl: true, kind: 'footwear', slot: 'shoes',  group: 'shoes',    warmth: 1, life: 4 },
  sneakers:     { label: 'Sneakers',           g: 'f', pl: true, kind: 'footwear', slot: 'shoes',  group: 'shoes',    warmth: 2, life: 3 },
  boots:        { label: 'Stivaletti',         g: 'm', pl: true, kind: 'footwear', slot: 'shoes',  group: 'shoes',    warmth: 3, life: 5 },
  sport_shoes:  { label: 'Scarpe sportive',    g: 'f', pl: true, kind: 'footwear', slot: 'shoes',  group: 'shoes',    warmth: 2, life: 2 },
  sandals:      { label: 'Sandali',            g: 'm', pl: true, kind: 'footwear', slot: 'shoes',  group: 'shoes',    warmth: 1, life: 3 },
}

export const SLOTS = {
  top: 'Sopra', mid: 'Strato', jacket: 'Giacca', outer: 'Capospalla', bottom: 'Sotto', shoes: 'Scarpe',
}

// neutral: si abbina a tutto. hue: tonalità (gradi) per gli accenti. l: luminosità 0-1
export const COLORS = {
  black:      { label: 'Nero', forms: ['nero', 'nera', 'neri', 'nere'],        hex: '#1b1b1b', neutral: true,  l: 0.08 },
  charcoal:   { label: 'Antracite',   hex: '#3d4045', neutral: true,  l: 0.25 },
  grey:       { label: 'Grigio', forms: ['grigio', 'grigia', 'grigi', 'grigie'],      hex: '#9a9c9e', neutral: true,  l: 0.6 },
  white:      { label: 'Bianco', forms: ['bianco', 'bianca', 'bianchi', 'bianche'],      hex: '#ffffff', neutral: true,  l: 1 },
  cream:      { label: 'Panna',       hex: '#efe8d6', neutral: true,  l: 0.92 },
  beige:      { label: 'Beige',       hex: '#cdb894', neutral: true,  l: 0.75 },
  camel:      { label: 'Cammello',    hex: '#b48a55', neutral: true,  l: 0.58 },
  brown:      { label: 'Marrone', forms: ['marrone', 'marrone', 'marroni', 'marroni'],     hex: '#6b4a2f', neutral: true,  l: 0.3 },
  navy:       { label: 'Blu navy',    hex: '#1f2b4a', neutral: true,  l: 0.15 },
  denim:      { label: 'Denim',       hex: '#4b6a8f', neutral: true,  l: 0.42 },
  blue:       { label: 'Blu',         hex: '#2f5fb3', neutral: false, hue: 220, l: 0.4 },
  light_blue: { label: 'Azzurro', forms: ['azzurro', 'azzurra', 'azzurri', 'azzurre'],     hex: '#a9c6e8', neutral: true,  hue: 210, l: 0.8 }, // nell'abbigliamento maschile l'azzurro chiaro fa da neutro
  olive:      { label: 'Verde oliva', hex: '#5d6234', neutral: false, hue: 65,  l: 0.35, soft: true },
  green:      { label: 'Verde', forms: ['verde', 'verde', 'verdi', 'verdi'],       hex: '#2f7a4b', neutral: false, hue: 140, l: 0.4 },
  burgundy:   { label: 'Bordeaux',    hex: '#6d1f2c', neutral: false, hue: 350, l: 0.22, soft: true },
  red:        { label: 'Rosso', forms: ['rosso', 'rossa', 'rossi', 'rosse'],       hex: '#c0302b', neutral: false, hue: 2,   l: 0.45 },
  pink:       { label: 'Rosa',        hex: '#e6a5b4', neutral: false, hue: 345, l: 0.78 },
  yellow:     { label: 'Giallo', forms: ['giallo', 'gialla', 'gialli', 'gialle'],      hex: '#e6c437', neutral: false, hue: 50,  l: 0.75 },
  orange:     { label: 'Arancio',     hex: '#d9752b', neutral: false, hue: 25,  l: 0.55 },
  purple:     { label: 'Viola',       hex: '#5e3f8a', neutral: false, hue: 275, l: 0.33 },
}

// Tessuto prevalente. warmth: correzione del peso se non indicato; cold/heat/rain: comportamento col meteo
export const FABRICS = {
  cotton:    { label: 'Cotone' },
  linen:     { label: 'Lino', warmth: -1, noCold: true },
  wool:      { label: 'Lana', warmth: 1, noHeat: true },
  cashmere:  { label: 'Cashmere', warmth: 1, noHeat: true },
  silk:      { label: 'Seta' },
  viscose:   { label: 'Viscosa' },
  polyester: { label: 'Poliestere' },
  polyamide: { label: 'Nylon' },
  leather:   { label: 'Pelle' },
  suede:     { label: 'Scamosciato', badInRain: true },
  canvas:    { label: 'Tela', badInRain: true },
  other:     { label: 'Altro' },
}
const FIBER_MAP = [
  [/cashmere|cachemire|kashmir/, 'cashmere'], [/lino|linen/, 'linen'], [/lana|wool|merino|alpaca|mohair|cammello/, 'wool'],
  [/cotone|cotton|denim/, 'cotton'], [/seta|silk/, 'silk'], [/viscosa|viscose|rayon|modal|lyocell|tencel|cupro/, 'viscose'],
  [/poliestere|polyester/, 'polyester'], [/poliammide|polyamide|nylon/, 'polyamide'],
  [/camoscio|scamosciat|suede/, 'suede'], [/pelle|cuoio|leather/, 'leather'], [/tela|canvas/, 'canvas'],
]
const STRETCH = /elast|spandex|lycra/
export function fabricFromFiber(fiber) {
  const f = String(fiber || '').toLowerCase()
  for (const [re, code] of FIBER_MAP) if (re.test(f)) return code
  return null
}
// Fibra prevalente della composizione (l'elastan non conta, a meno che sia l'unica)
export function fabricFromComposition(comp) {
  const list = (comp || []).filter((c) => !STRETCH.test(String(c.fiber).toLowerCase()))
  if (!list.length) return null
  const main = [...list].sort((a, b) => b.pct - a.pct)[0]
  return fabricFromFiber(main.fiber) || 'other'
}

export const SEASONS = { spring: 'Primavera', summer: 'Estate', autumn: 'Autunno', winter: 'Inverno' }
export const OCCASIONS = { formal: 'Lavoro formale', work: 'Lavoro informale', casual: 'Casual', sport: 'Sport' }
export const OCCASION_HINT = { formal: 'Riunioni, CdA', work: 'Ufficio', casual: 'Tempo libero', sport: 'Allenamento' }
export const FIT_FEEL = { tight: 'Stretto', right: 'Giusto', loose: 'Largo' }
export const WARMTH = { 1: 'Leggero', 2: 'Medio', 3: 'Pesante' }
export const SIZE_SYSTEMS = { IT: 'IT', EU: 'EU', UK: 'UK', US: 'US', LETTER: 'Lettere' }

export const SIZE_GROUPS = {
  shirts: 'Camicie', jackets: 'Giacche', trousers: 'Pantaloni', knit: 'Maglieria', shoes: 'Scarpe',
}

// Misure corporee con istruzioni brevi
export const MEASURES = [
  { key: 'height_cm', label: 'Altezza', unit: 'cm', how: 'Scalzo, schiena e talloni contro il muro, sguardo dritto. Segna il punto più alto della testa.' },
  { key: 'neck_cm', label: 'Collo', unit: 'cm', how: 'Metro alla base del collo, dove cade il colletto, lasciando un dito tra metro e pelle.' },
  { key: 'shoulders_cm', label: 'Spalle', unit: 'cm', how: 'Dietro la schiena, da una punta della spalla all’altra passando sopra la vertebra sporgente. Meglio farsi aiutare.' },
  { key: 'chest_cm', label: 'Torace', unit: 'cm', how: 'Sotto le ascelle, nel punto più ampio del petto, metro orizzontale, respiro normale.' },
  { key: 'waist_cm', label: 'Vita', unit: 'cm', how: 'Dove porti la cintura dei pantaloni, metro aderente ma non stretto.' },
  { key: 'hips_cm', label: 'Fianchi', unit: 'cm', how: 'Nel punto più ampio dei glutei, piedi uniti, metro orizzontale.' },
  { key: 'arm_length_cm', label: 'Lunghezza braccio', unit: 'cm', how: 'Braccio leggermente piegato: dalla punta della spalla, lungo il gomito, fino all’osso del polso.' },
  { key: 'inseam_cm', label: 'Cavallo interno', unit: 'cm', how: 'Dal cavallo fino a terra lungo l’interno gamba, scalzo. In alternativa misura un pantalone che ti sta bene.' },
  { key: 'thigh_cm', label: 'Circonferenza coscia', unit: 'cm', how: 'Nel punto più largo della coscia, circa 2 cm sotto il cavallo.' },
  { key: 'foot_length_cm', label: 'Lunghezza piede', unit: 'cm', how: 'A fine giornata, piede su un foglio contro il muro: dal tallone all’alluce. Misura entrambi e tieni il più lungo.' },
  { key: 'foot_width_cm', label: 'Larghezza piede', unit: 'cm', how: 'In piedi sul foglio: distanza tra i due punti più esterni dell’avampiede.' },
]
export const SHOE_MEASURES = [
  { key: 'shoe_it', label: 'Scarpe IT' }, { key: 'shoe_eu', label: 'Scarpe EU' },
  { key: 'shoe_uk', label: 'Scarpe UK' }, { key: 'shoe_us', label: 'Scarpe US' },
]

// Aggettivo di colore concordato con il nome del capo
export function colorAdj(color, category) {
  const c = COLORS[color], cat = CATEGORIES[category]
  if (!c) return ''
  if (!c.forms) return c.label.toLowerCase()
  const i = (cat?.g === 'f' ? 1 : 0) + (cat?.pl ? 2 : 0)
  return c.forms[i]
}

export const catOf = (code) => CATEGORIES[code] || null
export const slotOf = (item) => CATEGORIES[item?.category]?.slot || null
export const groupOf = (category) => CATEGORIES[category]?.group || null

export function seasonOfDate(d = new Date()) {
  const m = d.getMonth() + 1
  if (m >= 3 && m <= 5) return 'spring'
  if (m >= 6 && m <= 8) return 'summer'
  if (m >= 9 && m <= 11) return 'autumn'
  return 'winter'
}

// "98% cotone, 2% elastan" ⇄ [{fiber, pct}]
export function compositionToText(arr) {
  return (arr || []).map((c) => `${c.pct}% ${c.fiber}`).join(', ')
}
export function textToComposition(text) {
  return String(text || '').split(/[,;\n]+/).map((p) => {
    const m = p.trim().match(/^(\d+(?:[.,]\d+)?)\s*%?\s*(.+)$/) || p.trim().match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*%$/)
    if (!m) return null
    const [a, b] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]
    const pct = parseFloat(a.replace(',', '.'))
    return isFinite(pct) ? { fiber: b.trim().toLowerCase(), pct } : null
  }).filter(Boolean)
}

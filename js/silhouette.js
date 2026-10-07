// Sagome stilizzate dei capi: usate quando non c'è nessuna foto (né tua né di catalogo).
// Corpo nel colore principale, dettagli (colletto, bottoni, cuciture) nel primo colore secondario
// o in una tinta che contrasta. Tutte in viewBox 0 0 100 100, tratto semplice come le icone dell'app.
import { COLORS, CATEGORIES } from './taxonomy.js'

const LONG_SLEEVE_BODY = 'M34 14 L43 11 L50 18 L57 11 L66 14 L76 20 L86 72 L77 75 L68 40 L68 90 L32 90 L32 40 L23 75 L14 72 L24 20 Z'

// shape: corpo pieno; detail: linee di dettaglio
const SHAPES = {
  tshirt: { shape: 'M31 16 L42 12 Q50 21 58 12 L69 16 L87 31 L79 42 L70 37 L70 88 L30 88 L30 37 L21 42 L13 31 Z',
    detail: 'M42 12 Q50 21 58 12' },
  polo: { shape: 'M31 16 L42 12 L50 18 L58 12 L69 16 L87 31 L79 42 L70 37 L70 88 L30 88 L30 37 L21 42 L13 31 Z',
    detail: 'M42 12 L46 22 L50 18 L54 22 L58 12 M50 18 L50 34 M50 24 h0.1 M50 30 h0.1' },
  polo_ls: { shape: LONG_SLEEVE_BODY,
    detail: 'M43 11 L46 21 L50 18 L54 21 L57 11 M50 18 L50 34 M50 24 h0.1 M50 30 h0.1 M16 68 L23 70 M84 68 L77 70' },
  shirt: { shape: LONG_SLEEVE_BODY,
    detail: 'M43 11 L45 21 L50 18 L55 21 L57 11 M50 18 L50 90 M50 30 h0.1 M50 44 h0.1 M50 58 h0.1 M50 72 h0.1' },
  knit: { shape: 'M36 15 Q50 23 64 15 L76 20 L86 72 L77 75 L68 40 L68 90 L32 90 L32 40 L23 75 L14 72 L24 20 Z',
    detail: 'M36 15 Q50 23 64 15 M32 84 L68 84 M80 70 L84 69 M20 70 L16 69' },
  sweatshirt: { shape: 'M36 15 Q50 23 64 15 L76 20 L86 72 L77 75 L68 40 L68 90 L32 90 L32 40 L23 75 L14 72 L24 20 Z',
    detail: 'M38 15 Q50 34 62 15 M32 84 L68 84 M42 62 L58 62 L58 74 L42 74 Z' },
  vest: { shape: 'M36 12 L43 12 L50 42 L57 12 L64 12 L72 28 L70 90 L30 90 L28 28 Z',
    detail: 'M43 12 L50 42 L57 12 M50 42 L50 90 M50 52 h0.1 M50 64 h0.1 M50 76 h0.1' },
  blazer: { shape: LONG_SLEEVE_BODY,
    detail: 'M43 11 L47 30 L50 52 L53 30 L57 11 M47 30 L41 26 M53 30 L59 26 M50 52 L50 90 M47 60 h0.1 M47 70 h0.1 M36 64 L44 64 M56 64 L64 64' },
  jacket: { shape: 'M34 14 L43 11 L50 16 L57 11 L66 14 L76 20 L86 70 L77 73 L68 40 L68 84 L32 84 L32 40 L23 73 L14 70 L24 20 Z',
    detail: 'M50 16 L50 84 M32 78 L68 78 M37 50 L45 50 M55 50 L63 50' },
  coat: { shape: 'M34 12 L43 9 L50 15 L57 9 L66 12 L76 18 L86 72 L77 75 L68 38 L70 96 L30 96 L32 38 L23 75 L14 72 L24 18 Z',
    detail: 'M43 9 L47 28 L50 46 L53 28 L57 9 M50 46 L50 96 M46 54 h0.1 M54 54 h0.1 M46 66 h0.1 M54 66 h0.1 M46 78 h0.1 M54 78 h0.1' },
  raincoat: { shape: 'M34 12 L43 9 L50 15 L57 9 L66 12 L76 18 L86 72 L77 75 L68 38 L71 96 L29 96 L32 38 L23 75 L14 72 L24 18 Z',
    detail: 'M43 9 L47 26 L50 40 L53 26 L57 9 M50 40 L50 96 M31 54 L69 54 M47 51 L53 51 L53 57 L47 57 Z' },
  trousers: { shape: 'M30 8 L70 8 L74 94 L56 94 L50 34 L44 94 L26 94 Z',
    detail: 'M30 14 L70 14 M50 14 L50 30 M36 20 L40 30' },
  jeans: { shape: 'M30 8 L70 8 L74 94 L56 94 L50 34 L44 94 L26 94 Z',
    detail: 'M30 14 L70 14 M50 14 L50 32 M31 22 Q38 24 40 16 M69 22 Q62 24 60 16 M29 86 L44 86 M56 86 L72 86' },
  shorts: { shape: 'M28 24 L72 24 L76 70 L54 72 L50 46 L46 72 L24 70 Z',
    detail: 'M28 30 L72 30 M50 30 L50 44' },
  shoes_formal: { shape: 'M10 66 L10 50 Q12 46 18 46 L42 48 Q54 50 64 56 L84 60 Q94 62 94 70 L94 74 L10 74 Z',
    detail: 'M10 70 L94 70 M44 50 L52 56 M48 49 L56 55' },
  loafers: { shape: 'M10 66 L10 54 Q12 50 18 50 L44 52 Q56 52 66 58 L84 61 Q94 63 94 70 L94 74 L10 74 Z',
    detail: 'M10 70 L94 70 M46 54 Q56 52 62 58 M50 57 L58 57' },
  sneakers: { shape: 'M8 64 L8 46 Q10 40 18 40 L38 44 Q50 48 60 54 L82 58 Q94 60 94 68 L94 76 L8 76 Z',
    detail: 'M8 68 L94 68 M36 46 L44 52 M42 45 L50 51 M48 47 L56 53' },
  sport_shoes: { shape: 'M8 64 L8 44 Q10 38 18 38 L36 42 Q48 46 60 54 L82 58 Q94 60 94 68 L94 76 L8 76 Z',
    detail: 'M8 68 L94 68 M24 58 Q40 50 58 60 M36 45 L44 51 M42 44 L50 50' },
  boots: { shape: 'M18 76 L18 18 L42 18 L44 48 L78 56 Q92 58 92 68 L92 76 Z',
    detail: 'M18 70 L92 70 M18 24 L42 24 M30 30 L36 30 M30 38 L37 38' },
  sandals: { shape: 'M10 70 L94 70 L94 77 L10 77 Z M22 70 Q36 46 52 70 L45 70 Q36 56 29 70 Z M54 70 Q68 48 84 70 L77 70 Q68 58 61 70 Z',
    detail: 'M10 73 L94 73' },
  belt: { shape: 'M6 42 L74 42 L74 58 L6 58 Z M80 38 L96 38 L96 62 L80 62 Z',
    detail: 'M84 50 L74 50 M88 42 L88 58 M20 50 h0.1 M30 50 h0.1 M40 50 h0.1 M50 50 h0.1 M10 46 L70 46 M10 54 L70 54' },
}

// Completo: giacca sopra e gambe dei pantaloni sotto
const SUIT = {
  shape: 'M36 6 L44 4 L50 9 L56 4 L64 6 L72 11 L80 50 L73 52 L66 28 L66 62 L34 62 L34 28 L27 52 L20 50 L28 11 Z M36 62 L64 62 L66 98 L54 98 L50 70 L46 98 L34 98 Z',
  detail: 'M44 4 L47 18 L50 34 L53 18 L56 4 M50 34 L50 62 M47 40 h0.1 M47 48 h0.1 M37 46 L45 46 M55 46 L63 46 M36 62 L64 62',
}

const shapeOf = (category) => category === 'suit' ? SUIT : SHAPES[category] || (CATEGORIES[category]?.kind === 'footwear' ? SHAPES.sneakers : SHAPES.tshirt)

export function silhouetteSVG(item) {
  const c = COLORS[item?.color_primary]
  const fill = c?.hex || '#c9cbc6'
  const light = (c?.l ?? 0.7) >= 0.72
  const sec = (item?.colors_secondary || []).map((k) => COLORS[k]).find((x) => x && x.hex !== fill)
  const detail = sec ? sec.hex : light ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.42)'
  const edge = light ? 'rgba(0,0,0,.30)' : 'rgba(0,0,0,.18)'
  const s = shapeOf(item?.category)
  return `<svg viewBox="0 0 100 100" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">`
    + `<path d="${s.shape}" fill="${fill}" style="stroke:var(--sil-edge, ${edge})" stroke-width="1.8" fill-rule="evenodd"/>`
    + `<path d="${s.detail}" fill="none" stroke="${detail}" stroke-width="${sec ? 2.2 : 1.6}"/>`
    + `</svg>`
}

// Piccoli strumenti per costruire l'interfaccia senza framework.
import { COLORS } from './taxonomy.js'
import { silhouetteSVG } from './silhouette.js'

// Sostituisce/aggiunge figli ignorando null e false (il DOM nativo li scriverebbe come testo)
const clean = (xs) => xs.flat(Infinity).filter((x) => x != null && x !== false)
export const put = (el, ...children) => { el.replaceChildren(...clean(children)); return el }
export const add = (el, ...children) => { el.append(...clean(children)); return el }

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, v)
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

// Icone in stile simboli di lavaggio: tratto pulito, geometria semplice
const svg = (body, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`
export const icon = {
  today: svg('<path d="M8 3 4 5.5 2.5 10l3 1V21h13V11l3-1L20 5.5 16 3c-.6 1.6-2.2 2.6-4 2.6S8.6 4.6 8 3Z"/>'),
  closet: svg('<path d="M12 7.5V6.2c0-1 .9-1.7 1.8-1.7s1.7.8 1.7 1.7c0 1.2-1.2 1.6-2.2 2.3L3 15.5V18h18v-2.5L13.3 9"/>'),
  shop: svg('<path d="M3 12.6V4h8.6L21 13.4 13.4 21 3 12.6Z"/><circle cx="7.6" cy="8.4" r="1.4"/>'),
  measure: svg('<rect x="2.5" y="8" width="19" height="8"/><path d="M6 8v3M9.5 8v4.5M13 8v3M16.5 8v4.5M20 8v3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  camera: svg('<path d="M3 7.5h4l1.5-2.5h7L17 7.5h4V19H3Z"/><circle cx="12" cy="13" r="3.6"/>'),
  plus: svg('<path d="M12 4v16M4 12h16"/>'),
  event: svg('<rect x="3.5" y="5" width="17" height="15.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 14l2.5 2.5L16 12"/>'),
  trip: svg('<rect x="4" y="7.5" width="16" height="12.5"/><path d="M9 7.5V4.5h6v3M4 12.5h16M8 20v1.5M16 20v1.5"/>'),
  plans: svg('<rect x="4" y="7.5" width="16" height="12.5"/><path d="M9 7.5V4.5h6v3M4 12.5h16M8 20v1.5M16 20v1.5"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>', 18),
  back: svg('<path d="M15 5 8 12l7 7"/>'),
  check: svg('<path d="m4.5 12.5 4.5 4.5L19.5 6.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.2v.6"/>', 18),
  rain: svg('<path d="M7 15a4 4 0 0 1 .4-8A5 5 0 0 1 17 8a3.5 3.5 0 0 1 0 7Z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/>', 18),
  wind: svg('<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7"/>', 18),
  sync: svg('<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>', 18),
}

// Simboli del verdetto, presi dal linguaggio delle etichette di lavaggio:
// pieno = sì, triangolo = con cautela, barrato = no
export const verdictSymbol = {
  buy: svg('<rect x="3" y="3" width="18" height="18"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>', 64),
  consider: svg('<path d="M12 3.5 21.5 20h-19Z"/><path d="M12 10v4.5M12 16.6v.6"/>', 64),
  skip: svg('<rect x="3" y="3" width="18" height="18"/><circle cx="12" cy="12" r="6"/><path d="M2 2l20 20M22 2 2 22"/>', 64),
}

let toastTimer = null
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const el = document.getElementById('toast')
  put(el, h('span', null, msg), action ? h('button', { type: 'button', onclick: () => { el.classList.remove('show'); onAction?.() } }, action) : null)
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? ms + 2500 : ms)
}

// Gruppo di scelte (singola o multipla) — restituisce elemento con .value
// Gruppi di opzioni: al tocco si aggiorna solo lo stato dei pulsanti, senza ricostruirli.
// (Ricostruirli durante il tocco faceva "rimbalzare" il clic sulla prima opzione del gruppo.)
function optionGroup(wrap, entries, build, { multi, value, onchange }) {
  let cur = multi ? new Set(value || []) : value ?? null
  const isOn = (k) => (multi ? cur.has(k) : cur === k)
  const paint = () => wrap.querySelectorAll('button[data-k]').forEach((b) => {
    const on = isOn(b.dataset.k)
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', String(on))
  })
  const toggle = (k) => {
    if (multi) { cur.has(k) ? cur.delete(k) : cur.add(k) } else cur = cur === k ? null : k
    paint(); onchange?.(wrap.value)
  }
  const rebuild = () => { wrap.replaceChildren(...entries().map(([k, v]) => {
    const b = build(k, v)
    b.dataset.k = k
    b.type = 'button'
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(k) })
    return b
  })); paint() }
  Object.defineProperty(wrap, 'value', {
    get: () => (multi ? [...cur] : cur),
    set: (v) => { cur = multi ? new Set(v || []) : v ?? null; paint() },
  })
  wrap.refresh = rebuild
  rebuild()
  return wrap
}

export function choices(dict, value, { multi = false, onchange, hints } = {}) {
  const wrap = h('div', { class: 'choices', role: 'group' })
  return optionGroup(wrap, () => Object.entries(dict),
    (k, label) => h('button', { class: 'choice' }, label, hints?.[k] ? h('small', null, hints[k]) : null),
    { multi, value, onchange })
}

export function swatches(value, { multi = false, onchange, exclude } = {}) {
  const wrap = h('div', { class: 'swatches', role: 'group' })
  return optionGroup(wrap, () => Object.entries(COLORS).filter(([k]) => k !== exclude?.()),
    (k, c) => h('button', { class: 'sw', title: c.label, 'aria-label': c.label }, h('i', { style: { background: c.hex } }), h('span', null, c.label)),
    { multi, value, onchange })
}

// <label> solo per i campi nativi; i gruppi di pulsanti stanno in un <div> (dentro un <label> i tocchi vengono inoltrati al primo pulsante)
let fieldSeq = 0
const anchorOf = (label) => (typeof label === 'string' ? label : label?.firstChild?.textContent || label?.textContent || null)
export function field(label, control, hint) {
  const native = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
  const a = anchorOf(label)
  if (native) return h('label', { class: 'field', 'data-a': a }, h('span', { class: 'flabel' }, label), control, hint ? h('span', { class: 'fhint' }, hint) : null)
  const id = `fl-${++fieldSeq}`
  if (control.setAttribute) control.setAttribute('aria-labelledby', id)
  return h('div', { class: 'field', 'data-a': a }, h('span', { class: 'flabel', id }, label), control, hint ? h('span', { class: 'fhint' }, hint) : null)
}
export const section = (title, ...children) => h('section', { class: 'sec', 'data-a': title || null }, title ? h('h2', null, title) : null, ...children)

// Ridisegna senza far saltare la pagina: se arrivano risultati sopra ciò che stai guardando
// (lettura AI, ricerca online), il campo che avevi sotto il dito resta nello stesso punto dello schermo.
// Safari non ha l'ancoraggio automatico dello scorrimento, quindi lo facciamo a mano.
export function keepAnchor(root, fn) {
  if (window.scrollY < 4) return fn()
  const head = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0
  const before = [...root.querySelectorAll('[data-a]')].find((e) => e.getBoundingClientRect().bottom > head + 8)
  const key = before?.dataset.a, top = before?.getBoundingClientRect().top
  fn()
  if (key == null) return
  const after = [...root.querySelectorAll('[data-a]')].find((e) => e.dataset.a === key)
  const d = after ? after.getBoundingClientRect().top - top : 0
  if (Math.abs(d) > 1) window.scrollBy(0, d)
}

// Su iOS lo stato :active (riscontro al tocco) funziona solo se la pagina ascolta i touchstart
document.addEventListener('touchstart', () => {}, { passive: true })

// Foto di copertina: la tua o quella di catalogo (campo cover); se ne manca una, l'altra
export function coverPaths(it) {
  const own = { full: it?.photo_path || it?.thumb_path, thumb: it?.thumb_path || it?.photo_path }
  const cat = { full: it?.catalog_photo_path || it?.catalog_thumb_path, thumb: it?.catalog_thumb_path || it?.catalog_photo_path }
  const useCat = it?.cover === 'catalog' ? !!cat.full : !own.full && !!cat.full
  return useCat ? cat : own
}

export function thumb(item, cls = '') {
  const p = coverPaths(item)
  const path = cls.includes('big') ? p.full : p.thumb
  return h('span', { class: `ph ${cls}` + (path ? '' : ' sil') }, path
    ? h('img', { 'data-path': path, alt: '' })
    : h('span', { class: 'sil-art', html: silhouetteSVG(item) }))
}

// Immagine da un negozio online (solo anteprima): niente referrer, si nasconde se non si carica
export function remoteImg(url, cls = 'ph') {
  const img = url ? h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async' }) : null
  const box = h('span', { class: cls }, img || h('i', { style: { background: 'var(--rule)' } }))
  img?.addEventListener('error', () => img.replaceWith(h('i', { style: { background: 'var(--rule)' } })))
  return box
}

// Input file per foto: su iPhone offre "Scatta foto" o "Libreria"
export function photoPicker(label, { onpick, camera = false, preview } = {}) {
  const input = h('input', { type: 'file', accept: 'image/*', capture: camera ? 'environment' : null, class: 'visually-hidden' })
  const img = h('img', { alt: '' })
  const box = h('label', { class: 'picker' + (preview ? ' has' : '') }, input, img, h('span', { class: 'pk-label' }, h('span', { html: icon.camera }), label))
  if (preview) img.src = preview
  input.addEventListener('change', async () => {
    const f = input.files?.[0]
    if (!f) return
    img.src = URL.createObjectURL(f)
    box.classList.add('has')
    await onpick?.(f)
    input.value = ''
  })
  box.setPreview = (url) => { if (url) { img.src = url; box.classList.add('has') } }
  return box
}

export const fmtDate = (d) => new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })

// Foto di catalogo presa a mano: "Copia" sulla foto nel sito del negozio e qui "Incolla",
// oppure scelta dalla libreria. Serve quando il negozio non lascia scaricare la foto al server.
export function catalogPaste({ onblob, note } = {}) {
  const pick = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' })
  const zone = h('div', { class: 'pastezone', contenteditable: 'true', role: 'textbox', 'aria-label': 'Incolla qui la foto copiata dal sito', inputmode: 'none', spellcheck: 'false' })
  const take = (f) => { if (f && /^image\//.test(f.type)) onblob?.(f) }
  zone.addEventListener('paste', (e) => {
    e.preventDefault()
    const items = [...(e.clipboardData?.items || [])]
    const file = items.find((i) => i.kind === 'file' && /^image\//.test(i.type))?.getAsFile()
    zone.textContent = ''
    if (file) take(file)
    else toast('Negli appunti non c’è una foto: sul sito tieni premuto sull’immagine e scegli “Copia”')
  })
  zone.addEventListener('input', () => { zone.textContent = '' })
  pick.addEventListener('change', () => { take(pick.files?.[0]); pick.value = '' })
  return h('div', { class: 'catpaste' },
    h('p', { class: 'fhint' }, note || 'Foto del negozio a mano: sul sito tieni premuto sulla foto e scegli “Copia”, poi qui tocca il riquadro e “Incolla”.'),
    h('div', { class: 'row-btn' }, zone, h('label', { class: 'btn ghost' }, pick, 'Dalla libreria')))
}

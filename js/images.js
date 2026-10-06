// Foto: compressione prima del caricamento, base64 per l'AI, cache locale per l'uso offline.
import * as idb from './idb.js'
import { sb, BUCKET } from './store.js'

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Formato immagine non leggibile')) }
    img.src = url // Safari applica da sé l'orientamento EXIF
  })
}

// Ridimensiona al lato massimo indicato e salva in JPEG
export async function compress(file, maxSide = 1600, quality = 0.82) {
  const img = await loadImage(file)
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality))
  c.width = c.height = 0 // libera memoria su iOS
  if (!blob) throw new Error('Compressione non riuscita')
  return blob
}

export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

// Versioni pronte da una foto scelta: archivio, miniatura, AI
export async function prepare(file) {
  const [full, thumb, ai] = await Promise.all([compress(file, 1600, 0.82), compress(file, 480, 0.75), compress(file, 1280, 0.78)])
  return { full, thumb, ai }
}

const memo = new Map()
export async function imageURL(path) {
  if (!path) return null
  if (memo.has(path)) return memo.get(path)
  let blob = await idb.get('img', path).catch(() => null)
  if (!blob && sb && navigator.onLine) {
    const { data, error } = await sb.storage.from(BUCKET).download(path)
    if (!error && data) { blob = data; idb.put('img', data, path).catch(() => {}) }
  }
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  memo.set(path, url)
  return url
}

// Riempie gli <img data-path> presenti nel contenitore
export function hydrate(root) {
  root.querySelectorAll('img[data-path]:not([src])').forEach(async (img) => {
    const url = await imageURL(img.dataset.path)
    if (url) img.src = url
    else img.closest('.ph')?.classList.add('ph-missing')
  })
}

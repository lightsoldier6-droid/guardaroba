// Salvataggio di un capo con le sue foto: usato dalla scheda capo e dalla conferma in blocco della raffica.
import { state, upsert, upload, removeFiles, uuid, patch } from './store.js'

export const FIELDS = ['kind', 'category', 'name', 'brand', 'color_primary', 'colors_secondary', 'pattern', 'under_jacket', 'composition', 'fabric', 'fit', 'size_label', 'size_system',
  'size_alt', 'care', 'warmth', 'seasons', 'occasions', 'fit_feel', 'price', 'purchased_on', 'photo_path', 'thumb_path', 'label_photo_path', 'notes', 'archived',
  'article_code', 'color_code', 'ean', 'source_url', 'match_level', 'list_price', 'catalog_photo_path', 'catalog_thumb_path', 'cover']
export const ARRAYS = ['colors_secondary', 'composition', 'care', 'seasons', 'occasions', 'size_alt']

// draft: campi del capo; pending: { photo:{full,thumb}, label:{full}, catalog:{full,thumb} } (tutti facoltativi)
export async function saveItem(draft, pending = {}, existing = null) {
  const id = draft.id || uuid()
  const uid = state.user.id, ts = Date.now()
  const old = []
  if (pending.photo) {
    old.push(existing?.photo_path, existing?.thumb_path)
    draft.photo_path = `${uid}/${id}/photo-${ts}.jpg`
    draft.thumb_path = `${uid}/${id}/thumb-${ts}.jpg`
    await upload(draft.photo_path, pending.photo.full)
    await upload(draft.thumb_path, pending.photo.thumb)
  }
  if (pending.label) {
    old.push(existing?.label_photo_path)
    draft.label_photo_path = `${uid}/${id}/label-${ts}.jpg`
    await upload(draft.label_photo_path, pending.label.full)
  }
  if (pending.catalog) {
    draft.catalog_photo_path = `${uid}/${id}/catalog-${ts}.jpg`
    draft.catalog_thumb_path = `${uid}/${id}/catalog-thumb-${ts}.jpg`
    await upload(draft.catalog_photo_path, pending.catalog.full)
    await upload(draft.catalog_thumb_path, pending.catalog.thumb)
  }
  if (existing?.catalog_photo_path && existing.catalog_photo_path !== draft.catalog_photo_path) old.push(existing.catalog_photo_path, existing.catalog_thumb_path)
  if (!draft.catalog_photo_path && draft.cover === 'catalog') draft.cover = null
  if (!draft.cover && draft.catalog_photo_path) draft.cover = 'catalog'
  const row = { id }
  for (const k of FIELDS) row[k] = draft[k] ?? (ARRAYS.includes(k) ? [] : null)
  row.archived = !!draft.archived
  await upsert('items', row)
  await removeFiles(old)
  return id
}

// Toglie le foto del capo scattate da te (non l'etichetta né la foto di catalogo).
// Senza altre foto, l'app mostra la sagoma stilizzata nel colore principale.
export async function dropOwnPhotos(items) {
  let n = 0
  for (const it of items) {
    if (!it.photo_path && !it.thumb_path) continue
    await removeFiles([it.photo_path, it.thumb_path])
    await patch('items', it.id, { photo_path: null, thumb_path: null, cover: it.catalog_photo_path ? 'catalog' : null })
    n++
  }
  return n
}

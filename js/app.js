import { h, icon, toast } from './ui.js'
import { state, sb, configured, subscribe, loadCache, sync } from './store.js'
import * as idb from './idb.js'
import * as today from './views/today.js'
import * as wardrobe from './views/wardrobe.js'
import * as itemForm from './views/itemForm.js'
import * as shop from './views/shop.js'
import * as measures from './views/measures.js'
import * as settings from './views/settings.js'
import * as batchView from './views/batchView.js'
import * as plans from './views/plans.js'
import * as batch from './batch.js'

const view = document.getElementById('view')
const titleEl = document.getElementById('title')
const backBtn = document.getElementById('back')
const syncEl = document.getElementById('syncstate')

const ROUTES = [
  [/^#\/?(oggi)?$/, today, 'today'],
  [/^#\/armadio$/, wardrobe, 'closet'],
  [/^#\/capo\/nuovo$/, itemForm, 'closet', true],
  [/^#\/capo\/([\w-]+)\/modifica$/, itemForm, 'closet', true, 'id'],
  [/^#\/capo\/([\w-]+)$/, { ...wardrobe, render: wardrobe.renderItem, title: 'Capo' }, 'closet', true, 'id'],
  [/^#\/raffica$/, batchView, 'closet', true],
  [/^#\/eventi$/, plans, 'plans'],
  [/^#\/eventi\/nuovo\/(evento|viaggio)$/, { ...plans, render: plans.renderForm, title: 'Nuovo', live: false }, 'plans', true, 'kind'],
  [/^#\/eventi\/([\w-]+)\/modifica$/, { ...plans, render: plans.renderForm, title: 'Modifica', live: false }, 'plans', true, 'id'],
  [/^#\/eventi\/([\w-]+)$/, { ...plans, render: plans.renderPlan }, 'plans', true, 'id'],
  [/^#\/negozio$/, shop, 'shop'],
  [/^#\/misure$/, measures, 'measure'],
  [/^#\/impostazioni$/, settings, null, true],
]

let current = null

export function go(hash, { replace = false } = {}) {
  if (replace) { history.replaceState(null, '', hash); route() } else location.hash = hash
}

function route() {
  if (!configured) return paint(settings.renderSetup, 'Configurazione')
  if (!state.user) return paint(settings.renderLogin, 'Accesso', { tabs: false })
  const hash = location.hash || '#/'
  for (const [re, mod, tab, sub, param] of ROUTES) {
    const m = hash.match(re)
    if (!m) continue
    const params = param ? { [param]: m[1] } : {}
    current = { mod, params, tab, sub }
    return paint((root) => mod.render(root, { go, params, rerender }), mod.title, { tab, sub })
  }
  go('#/', { replace: true })
}

function paint(fn, title, { tab = null, sub = false, tabs = true } = {}) {
  const root = h('div', { class: 'view' })
  fn(root)
  view.replaceChildren(root)
  titleEl.textContent = title || ''
  backBtn.hidden = !sub
  document.body.classList.toggle('no-tabs', !tabs)
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab))
  if (!document.body.dataset.keepScroll) view.scrollTop = 0
}

function rerender() {
  if (!current) return
  const y = view.scrollTop
  document.body.dataset.keepScroll = '1'
  route()
  delete document.body.dataset.keepScroll
  view.scrollTop = y
}

function paintSync() {
  const s = !state.online ? 'offline' : state.syncing ? 'sync' : state.pending ? 'pending' : 'ok'
  syncEl.dataset.state = s
  syncEl.title = { offline: 'Offline', sync: 'Sincronizzo…', pending: `${state.pending} modifiche in attesa`, ok: 'Sincronizzato' }[s]
  syncEl.querySelector('span').textContent = s === 'offline' ? 'offline' : state.pending ? String(state.pending) : ''
}

let lastData = null
subscribe(() => {
  paintSync()
  const sig = `${state.items.length}|${state.wearLog.length}|${state.measures.length}|${state.plans.length}|${state.lastSync}|${state.items.map((i) => i.updated_at || '').join()}|${state.plans.map((p) => p.updated_at || '').join()}`
  if (current?.mod?.live && sig !== lastData) { lastData = sig; rerender() }
  else lastData = sig
})

backBtn.innerHTML = icon.back
backBtn.addEventListener('click', () => (history.length > 1 ? history.back() : go('#/')))
document.getElementById('gear').innerHTML = icon.gear
document.querySelectorAll('.tabbar a').forEach((a) => { a.querySelector('i').innerHTML = icon[a.dataset.tab] })
window.addEventListener('hashchange', route)

async function start() {
  if (!configured) return route()
  let { data } = await sb.auth.getSession().catch(() => ({ data: null }))
  let user = data?.session?.user || null
  if (!user && !navigator.onLine) {
    // offline con sessione scaduta: lavora sulla cache, la sincronizzazione riparte con la rete
    const c = await idb.get('kv', 'cache').catch(() => null)
    if (c?.userId) user = { id: c.userId, email: '' }
  }
  if (user) { state.user = user; await loadCache(user.id) }
  route()
  paintSync()
  if (user) { sync(); batch.load().then(() => batch.run()) }
  sb.auth.onAuthStateChange(async (event, session) => {
    const u = session?.user || null
    if (event === 'SIGNED_IN' && u && u.id !== state.user?.id) { state.user = u; await loadCache(u.id); route(); sync(); batch.load().then(() => batch.run()) }
    else if (event === 'SIGNED_OUT') { state.user = null; route() }
    else if (u) state.user = u
  })
  navigator.storage?.persist?.().catch(() => {})
}

if ('serviceWorker' in navigator) {
  const reg = navigator.serviceWorker.register('./sw.js').catch((e) => { console.warn('SW', e); return null })
  // iOS riprende l'app dal multitasking senza ricaricarla: a ogni ritorno controlla se c'è una versione nuova
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && navigator.onLine) (await reg)?.update().catch(() => {})
  })
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    // nuova versione installata: se stai compilando un modulo non ricarica da sola, chiede
    if (current?.mod === itemForm || current?.mod === shop || current?.mod === batchView) {
      toast('È pronta una nuova versione dell’app', { action: 'Aggiorna', onAction: () => { reloaded = true; location.reload() }, ms: 8000 })
      return
    }
    reloaded = true; location.reload()
  })
}

start()

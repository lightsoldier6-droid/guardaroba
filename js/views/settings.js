import { h, put, add, toast, section, field, icon } from '../ui.js'
import { state, sb, sync, clearLocal } from '../store.js'
import { dropOwnPhotos } from '../itemsave.js'
import { getPlace, setPlace, searchCity, getWeather } from '../weather.js'

export const title = 'Impostazioni'
export const live = true

let place = null
getPlace().then((p) => { place = p || null })

export function render(root, { rerender, go }) {
  const q = h('input', { type: 'search', placeholder: 'Città, es. Lecce', enterkeyhint: 'search' })
  const results = h('ul', { class: 'cities' })
  const find = async () => {
    if (!q.value.trim()) return
    try {
      const list = await searchCity(q.value.trim())
      put(results, ...(list.length ? list.map((c) => h('li', null, h('button', { type: 'button', class: 'link', onclick: async () => {
        await setPlace(c); place = c; await getWeather({ force: true }); toast(`Città impostata: ${c.name}`); rerender()
      } }, c.name))) : [h('li', { class: 'muted' }, 'Nessuna città trovata')]))
    } catch { put(results, h('li', { class: 'muted' }, 'Ricerca non disponibile offline')) }
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find() } })

  const last = state.lastSync ? new Date(state.lastSync).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'mai'
  add(root, 
    section('Sincronizzazione',
      h('p', null, state.online ? 'Online' : 'Offline: le modifiche restano sul telefono e partono appena torna la rete.'),
      h('p', { class: 'muted' }, `Ultima sincronizzazione: ${last}. Modifiche in attesa: ${state.pending}.`),
      state.errors.length ? h('details', null, h('summary', null, `${state.errors.length} modifiche non accettate dal server`),
        h('ul', null, state.errors.map((e) => h('li', null, `${e.what}: ${e.message}`)))) : null,
      h('button', { class: 'btn ghost', disabled: state.syncing || !state.online, onclick: () => sync() }, h('span', { html: icon.sync }), state.syncing ? 'Sincronizzo…' : 'Sincronizza ora')),
    section('Meteo',
      h('p', { class: 'muted' }, 'Uso la posizione del telefono. Se non è disponibile, uso questa città: ', h('b', null, place?.name || 'nessuna')),
      field('Cerca città', h('div', { class: 'row-btn' }, q, h('button', { type: 'button', class: 'btn ghost', onclick: find }, 'Cerca'))),
      results),
    section('Foto dei capi',
      (() => {
        const mine = state.items.filter((i) => i.photo_path || i.thumb_path)
        return [
          h('p', { class: 'muted' }, mine.length
            ? `${mine.length} ${mine.length === 1 ? 'capo ha' : 'capi hanno'} una foto scattata da te. Puoi eliminarle tutte: al loro posto vedrai la foto di catalogo, se c’è, altrimenti la sagoma stilizzata nel colore del capo. Le foto delle etichette restano.`
            : 'Nessun capo ha foto scattate da te: l’armadio usa foto di catalogo e sagome stilizzate.'),
          mine.length ? h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm(`Eliminare definitivamente le tue foto di ${mine.length} ${mine.length === 1 ? 'capo' : 'capi'}? Le etichette e le foto di catalogo restano.`)) return
            const n = await dropOwnPhotos(mine); toast(`${n} foto eliminate`); rerender()
          } }, `Elimina le mie foto (${mine.length})`) : null,
        ]
      })()),
    section('Versione',
      h('p', { class: 'muted', id: 'appver' }, 'Versione dell’app: …')),
    section('Account',
      h('p', { class: 'muted' }, state.user?.email || ''),
      h('button', { class: 'btn ghost', onclick: async () => {
        if (state.pending && !confirm(`Ci sono ${state.pending} modifiche non ancora inviate: uscendo andranno perse. Uscire comunque?`)) return
        await sb.auth.signOut(); await clearLocal(); go('#/')
      } }, 'Esci')),
  )
  setTimeout(showVersion, 0)
}

// ---------- Accesso -------------------------------------------------
// versione installata = nome della cache del service worker (es. guardaroba-v8)
async function showVersion() {
  const el = document.getElementById('appver')
  if (!el) return
  const keys = await caches?.keys?.().catch(() => []) || []
  const v = keys.filter((k) => k.startsWith('guardaroba-v')).sort().pop()
  el.textContent = v ? `Versione dell’app: ${v.replace('guardaroba-', '')}` : 'Versione dell’app: non installata'
}

export function renderLogin(root) {
  const email = h('input', { type: 'email', autocomplete: 'username', inputmode: 'email', required: true, autocapitalize: 'none' })
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true })
  const err = h('p', { class: 'err', role: 'alert' })
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Accedi')
  add(root, h('form', { class: 'login label', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value })
    btn.disabled = false
    if (error) err.textContent = /api key|apikey/i.test(error.message) ? 'Chiave pubblicabile non valida in js/config.js: deve contenere solo il valore che inizia con sb_publishable_.'
      : /invalid login|credentials/i.test(error.message) ? 'Email o password non corrette.'
      : /not confirmed/i.test(error.message) ? 'Utente non confermato: su Supabase spunta Auto Confirm User o conferma l’email.'
      : /fetch|network/i.test(error.message) ? 'Serve la connessione per il primo accesso.' : error.message
  } },
  h('h2', null, 'Guardaroba'),
  h('p', { class: 'muted' }, 'Accedi con l’utente creato su Supabase. Dopo il primo accesso l’app funziona anche offline.'),
  field('Email', email), field('Password', pass), err, btn))
}

export function renderSetup(root) {
  add(root, h('div', { class: 'empty' },
    h('h3', null, 'Manca la configurazione'),
    h('p', null, 'Apri il file js/config.js nel repository e inserisci l’URL del progetto Supabase e la chiave pubblicabile (sb_publishable_…). Le istruzioni sono in SETUP.md, al punto 4.')))
}

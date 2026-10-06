// Pannello "Trovato online": mostra l'esito della ricerca e chiede solo ciò che serve.
//   exact    → già applicato; puoi dire "Non è il mio"
//   model    → modello trovato: scegli il tuo colore tra le varianti
//   possible → scegli il tuo tra i candidati (o "Nessuno")
//   none     → niente: aggiungi una foto del capo
import { h, remoteImg, section } from '../ui.js'
import { COLORS, colorFromName } from '../taxonomy.js'
import { LEVEL_TEXT, modelName } from '../webmatch.js'

export const newWebState = () => ({ status: 'idle', msg: '', result: null, picked: null, choosing: null, rejected: false, imgBusy: false, imgMsg: '' })

const eur = (n, cur) => (n ? Number(n).toLocaleString('it-IT', { style: 'currency', currency: cur || 'EUR' }) : null)

function candCard(c, { actions = [], img } = {}) {
  return h('div', { class: 'cand' },
    img || remoteImg(c.image, 'ph cand-img'),
    h('div', { class: 'cand-body' },
      h('b', null, c.displayTitle || modelName(c, c.brand) || c.title || c.domain),
      h('span', { class: 'muted' }, [c.domain, eur(c.price, c.currency)].filter(Boolean).join(' · ')),
      c.why ? h('span', { class: 'cand-why' }, `Riconosciuto da: ${c.why}`) : null,
      c.source === 'search' ? h('span', { class: 'cand-why' }, 'Pagina non leggibile dal negozio: niente foto, apri il link per vederla') : null,
      h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer', class: 'cand-link' }, 'Apri la pagina'),
      actions.length ? h('div', { class: 'cand-actions' }, actions) : null))
}

function variantGrid(c, { onPick, suggested = -1, picked = -1 }) {
  return h('div', { class: 'variants' }, c.variants.map((v, i) => {
    const code = colorFromName(v.color)
    return h('button', { type: 'button', class: 'variant' + (i === picked ? ' on' : '') + (i === suggested ? ' sug' : ''), onclick: () => onPick(i) },
      v.image ? remoteImg(v.image, 'ph') : h('span', { class: 'ph' }, h('i', { style: { background: COLORS[code]?.hex || 'var(--rule)' } })),
      h('span', null, v.color || `Variante ${i + 1}`),
      i === suggested ? h('small', null, 'come in etichetta') : null)
  }))
}

// web: stato (newWebState). handlers: { search, apply(ci, vi, level), reject(), none(), canSearch, catalogPreview }
export function webPanel(web, handlers) {
  const { search, apply, reject, none, canSearch, catalogPreview } = handlers
  if (web.status === 'idle') {
    if (canSearch) return h('div', { class: 'webbar' }, h('span', null, 'Cerca il capo online da marca e codici dell’etichetta.'),
      h('button', { type: 'button', class: 'mini', onclick: search }, 'Cerca online'))
    return handlers.hint ? h('div', { class: 'webbar' }, h('span', null, handlers.hint)) : null
  }
  if (web.status === 'busy') return h('div', { class: 'ai-bar busy' }, h('span', null, 'Cerco il capo online…'))
  if (web.status === 'error') {
    return h('div', { class: 'webbar err' }, h('span', null, web.msg),
      canSearch ? h('button', { type: 'button', class: 'mini', onclick: search }, 'Riprova') : null)
  }

  const r = web.result || { level: 'none', candidates: [] }
  const cands = r.candidates || []
  const imgNote = web.imgBusy ? h('p', { class: 'fhint' }, 'Scarico la foto di catalogo…') : web.imgMsg ? h('p', { class: 'fhint' }, web.imgMsg) : null

  // già applicato
  if (web.picked) {
    const c = cands[web.picked.ci]
    const v = web.picked.vi >= 0 ? c?.variants?.[web.picked.vi] : null
    if (c) {
      const title = web.picked.level === 'exact' ? LEVEL_TEXT.exact : web.picked.level === 'model' ? 'Modello e colore confermati' : 'Scelto da te'
      return section(null, h('div', { class: `webres lvl-${web.picked.level}` },
        h('p', { class: 'lvl' }, title),
        candCard({ ...c, displayTitle: [modelName(c, c.brand) || c.title, v?.color].filter(Boolean).join(' — ') }, {
          img: catalogPreview ? h('span', { class: 'ph cand-img' }, h('img', { src: catalogPreview, alt: '' })) : remoteImg(v?.image || c.image, 'ph cand-img'),
          actions: [
            c.variants?.length > 1 ? h('button', { type: 'button', class: 'mini', onclick: () => handlers.choose(web.picked.ci) }, 'Cambia colore') : null,
            h('button', { type: 'button', class: 'mini', onclick: reject }, 'Non è il mio'),
          ].filter(Boolean),
        }), imgNote))
    }
  }

  // scelta del colore per un candidato
  if (web.choosing != null && cands[web.choosing]) {
    const ci = web.choosing, c = cands[ci]
    const level = r.level === 'model' && ci === 0 && !web.rejected ? 'model' : 'chosen'
    return section(null, h('div', { class: 'webres lvl-model' },
      h('p', { class: 'lvl' }, 'Quale colore hai?'),
      candCard(c),
      variantGrid(c, { onPick: (vi) => apply(ci, vi, level), suggested: c.suggested }),
      h('div', { class: 'cand-actions' },
        h('button', { type: 'button', class: 'link', onclick: () => apply(ci, -1, level) }, 'Il mio colore non c’è: usa solo il modello'),
        h('button', { type: 'button', class: 'link', onclick: reject }, 'Non è questo modello'))))
  }

  const level = web.rejected ? (cands.length ? 'possible' : 'none') : r.level
  if (level === 'model' && cands[0]) {
    const c = cands[0]
    return section(null, h('div', { class: 'webres lvl-model' },
      h('p', { class: 'lvl' }, LEVEL_TEXT.model),
      c.variants?.length > 1
        ? [candCard(c), h('p', { class: 'fhint' }, 'Tocca il colore che hai:'), variantGrid(c, { onPick: (vi) => apply(0, vi, 'model'), suggested: c.suggested }),
          h('div', { class: 'cand-actions' }, h('button', { type: 'button', class: 'link', onclick: () => apply(0, -1, 'model') }, 'Il mio colore non c’è: usa solo il modello'),
            h('button', { type: 'button', class: 'link', onclick: reject }, 'Non è questo modello'))]
        : candCard(c, { actions: [
          h('button', { type: 'button', class: 'mini', onclick: () => apply(0, -1, 'model') }, c.color ? `Sì, è ${c.color}` : 'Sì, è questo'),
          h('button', { type: 'button', class: 'mini', onclick: reject }, 'No'),
        ] })))
  }
  if (level === 'possible' && cands.length) {
    return section(null, h('div', { class: 'webres lvl-possible' },
      h('p', { class: 'lvl' }, web.rejected ? 'È uno di questi?' : LEVEL_TEXT.possible),
      h('p', { class: 'fhint' }, 'Confronta la foto con il tuo capo.'),
      cands.map((c, ci) => candCard(c, { actions: [h('button', { type: 'button', class: 'mini', onclick: () => (c.variants?.length > 1 ? handlers.choose(ci) : apply(ci, -1, 'chosen')) }, 'È questo')] })),
      h('div', { class: 'cand-actions' }, h('button', { type: 'button', class: 'link', onclick: none }, 'Nessuno di questi'))))
  }
  return h('div', { class: 'webbar' }, h('span', null, web.noneByUser ? 'Ok, niente dati dal web.' : `${LEVEL_TEXT.none}. Aggiungi una foto del capo e controlla i campi.`),
    canSearch ? h('button', { type: 'button', class: 'mini', onclick: search }, 'Cerca di nuovo') : null)
}

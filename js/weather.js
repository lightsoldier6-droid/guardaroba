// Meteo del giorno da Open-Meteo (gratuito, senza chiave). Posizione dal GPS, altrimenti città salvata.
import * as idb from './idb.js'

const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'

async function fetchJSON(url, ms = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

function position() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'Posizione attuale' }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
    )
  })
}

export const getPlace = () => idb.get('kv', 'place')
export const setPlace = (p) => idb.put('kv', p, 'place')

export async function searchCity(q) {
  const j = await fetchJSON(`${GEOCODE}?name=${encodeURIComponent(q)}&count=5&language=it&format=json`)
  return (j.results || []).map((r) => ({ lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', ') }))
}

const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

// Ritorna { tmax, tmin, feelsMax, feelsMin, rainProb, rainMm, windMax, place, stale }
export async function getWeather({ force = false } = {}) {
  const cached = await idb.get('kv', 'weather').catch(() => null)
  if (!force && cached && cached.date === today() && Date.now() - cached.at < 3 * 3600 * 1000) return cached
  try {
    const place = (await position()) || (await getPlace())
    if (!place) return cached?.date === today() ? { ...cached, stale: true } : { needPlace: true }
    const params = new URLSearchParams({
      latitude: place.lat.toFixed(3), longitude: place.lon.toFixed(3), timezone: 'auto', forecast_days: '1',
      daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    })
    const j = await fetchJSON(`${FORECAST}?${params}`)
    const d = j.daily
    const w = {
      date: today(), at: Date.now(), place: place.name,
      tmax: d.temperature_2m_max[0], tmin: d.temperature_2m_min[0],
      feelsMax: d.apparent_temperature_max[0], feelsMin: d.apparent_temperature_min[0],
      rainMm: d.precipitation_sum[0], rainProb: d.precipitation_probability_max[0], windMax: d.wind_speed_10m_max[0],
    }
    await idb.put('kv', w, 'weather')
    return w
  } catch {
    return cached?.date === today() ? { ...cached, stale: true } : null
  }
}

// ---------- Meteo per eventi e viaggi ------------------------------------
// Fino a 15 giorni da oggi: previsioni. Più avanti: media dello stesso periodo nei 3 anni precedenti ("tipico").
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const DAILY = 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,wind_speed_10m_max'
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const shiftYear = (iso, n) => { const [y, m, d] = iso.split('-'); return `${Number(y) + n}-${m}-${m === '02' && d === '29' ? '28' : d}` }
export const datesBetween = (start, end) => { const out = []; for (let d = start; d <= end && out.length < 31; d = addDays(d, 1)) out.push(d); return out }

function rows(j, extra = {}) {
  const d = j?.daily
  if (!d?.time) return {}
  return Object.fromEntries(d.time.map((t, i) => [t, {
    tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
    feelsMax: d.apparent_temperature_max?.[i] ?? d.temperature_2m_max[i], feelsMin: d.apparent_temperature_min?.[i] ?? d.temperature_2m_min[i],
    rainMm: d.precipitation_sum?.[i] ?? 0, rainProb: d.precipitation_probability_max?.[i] ?? null, windMax: d.wind_speed_10m_max?.[i] ?? 0, ...extra,
  }]))
}

// place: { name, lat, lon }. Ritorna { [data]: { tmax, tmin, ..., kind: 'forecast' | 'typical' } } (date senza dati: assenti)
export async function getRangeWeather(place, start, end) {
  if (!place?.lat || !start) return {}
  end = end || start
  const key = `wx:${place.lat.toFixed(2)},${place.lon.toFixed(2)}:${start}:${end}`
  const cached = await idb.get('kv', key).catch(() => null)
  if (cached && Date.now() - cached.at < 3 * 3600 * 1000) return cached.data
  const t = today(), lastForecast = addDays(t, 15)
  const out = {}
  const base = { latitude: place.lat.toFixed(3), longitude: place.lon.toFixed(3), timezone: 'auto' }
  try {
    // previsioni per la parte di date entro 15 giorni
    const fs = start < t ? t : start, fe = end > lastForecast ? lastForecast : end
    if (fs <= fe) {
      const p = new URLSearchParams({ ...base, start_date: fs, end_date: fe, daily: DAILY + ',precipitation_probability_max' })
      Object.assign(out, rows(await fetchJSON(`${FORECAST}?${p}`), { kind: 'forecast' }))
    }
    // il resto: stesso periodo degli anni passati, in media
    const rest = datesBetween(start, end).filter((d) => !out[d] && d >= t)
    if (rest.length) {
      const years = await Promise.all([1, 2, 3].map((n) => {
        const p = new URLSearchParams({ ...base, start_date: shiftYear(rest[0], -n), end_date: shiftYear(rest[rest.length - 1], -n), daily: DAILY })
        return fetchJSON(`${ARCHIVE}?${p}`, 10000).then((j) => rows(j)).catch(() => ({}))
      }))
      for (const d of rest) {
        const vals = years.map((y, i) => y[shiftYear(d, -(i + 1))]).filter((v) => v && v.tmax != null)
        if (!vals.length) continue
        const avg = (k) => vals.reduce((s, v) => s + (v[k] ?? 0), 0) / vals.length
        const rainy = vals.filter((v) => (v.rainMm ?? 0) >= 1.5).length
        out[d] = { tmax: avg('tmax'), tmin: avg('tmin'), feelsMax: avg('feelsMax'), feelsMin: avg('feelsMin'), rainMm: rainy * 2 >= vals.length ? avg('rainMm') : 0,
          rainProb: Math.round((rainy / vals.length) * 100), windMax: avg('windMax'), kind: 'typical' }
      }
    }
  } catch { if (cached) return cached.data }
  await idb.put('kv', { at: Date.now(), data: out }, key).catch(() => {})
  return out
}

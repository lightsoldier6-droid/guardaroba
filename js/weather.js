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

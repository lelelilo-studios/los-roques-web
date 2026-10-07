// Current conditions at Los Roques from Open-Meteo (no key needed; CC BY 4.0, non-commercial use).
// Fails soft: if anything goes wrong the caller keeps the climate normals.

const PLACE = 'latitude=11.95&longitude=-66.68&timezone=America%2FCaracas';
const FORECAST = `https://api.open-meteo.com/v1/forecast?${PLACE}&wind_speed_unit=ms&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;
const MARINE = `https://marine-api.open-meteo.com/v1/marine?${PLACE}&current=wave_height,wave_direction,wave_period,sea_surface_temperature,sea_level_height_msl`;
const KEY = 'los-roques-live-weather', MAX_AGE = 15 * 60 * 1000;

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/**
 * Resolves to { wind (m/s), windFrom (deg), gusts, cloud (0..1), air (C), rain (mm), waveHeight (m), wavePeriod (s),
 * sea (C), seaLevel (m), time (ISO, local) } or null when the service cannot be reached.
 */
export async function fetchLiveWeather() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.at < MAX_AGE) return cached.data;
  } catch { /* no storage: just fetch */ }
  try {
    const [f, m] = await Promise.all([json(FORECAST), json(MARINE).catch(() => null)]);
    const c = f.current, s = m?.current || {}, num = v => (Number.isFinite(v) ? v : null);
    const data = {
      wind: num(c.wind_speed_10m), windFrom: num(c.wind_direction_10m), gusts: num(c.wind_gusts_10m), cloud: num(c.cloud_cover) === null ? null : c.cloud_cover / 100,
      air: num(c.temperature_2m), rain: num(c.precipitation), waveHeight: num(s.wave_height), wavePeriod: num(s.wave_period),
      sea: num(s.sea_surface_temperature), seaLevel: num(s.sea_level_height_msl), time: c.time,
    };
    if (data.wind === null || data.windFrom === null) return null;
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* fine */ }
    return data;
  } catch {
    return null;
  }
}

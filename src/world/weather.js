// Climate of Los Roques and the weather presets.
// Monthly normals: wind speed and direction, cloud amount and sea temperature from NASA POWER (2001-2020);
// offshore wave height from the Open-Meteo marine model (2023-2024); air temperature from climate tables.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const CLIMATE = {
  wind: [8.0, 8.2, 8.0, 7.9, 8.1, 8.2, 7.5, 6.8, 6.4, 6.3, 6.7, 7.7],          // m/s
  windFrom: [78, 78, 78, 82, 88, 90, 88, 92, 94, 91, 83, 78],                   // degrees
  cloud: [0.33, 0.31, 0.38, 0.56, 0.57, 0.55, 0.46, 0.41, 0.46, 0.53, 0.51, 0.39],
  sea: [26.7, 26.3, 26.3, 26.7, 27.3, 27.5, 27.7, 28.4, 28.9, 28.9, 28.6, 27.7],  // degrees C
  waveHs: [1.39, 1.35, 1.33, 1.23, 1.31, 1.23, 1.16, 0.95, 0.96, 0.98, 1.19, 1.29],  // m, offshore
  airMax: [29, 30, 31, 31, 32, 31, 31, 32, 32, 32, 31, 30],
  rain: [30, 15, 10, 10, 10, 15, 25, 20, 25, 30, 60, 55],                       // mm
};

/** Weather presets. `wind` null = the month's normal trade wind. haze scales the aerosol in the air. */
export const WEATHER = {
  clear: { label: 'Calm & clear', wind: 4, haze: 0.7, cloud: 0.04 },
  trade: { label: 'Trade winds', wind: null, haze: 1.0, cloud: 0.2 },
  strong: { label: 'Strong trades', wind: 12, haze: 1.5, cloud: 0.32 },
};

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
export const knots = ms => ms * 1.94384;

/** Resolves a preset for a month (0-11) into numbers. */
export function conditions(preset, month) {
  const w = WEATHER[preset] || WEATHER.trade;
  return {
    wind: w.wind ?? CLIMATE.wind[month], windFrom: CLIMATE.windFrom[month], haze: w.haze, cloud: w.cloud,
    sea: CLIMATE.sea[month], airMax: CLIMATE.airMax[month],
  };
}

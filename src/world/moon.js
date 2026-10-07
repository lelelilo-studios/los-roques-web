// Where the moon is and how much of it is lit, for any date and time (the low-precision series of the
// Astronomical Almanac: good to about half a degree, which is the moon's own width). No imports: also used by
// the Node tests.
import { SITE } from './sun.js';

const RAD = Math.PI / 180;
const mod = (v, m) => ((v % m) + m) % m;
const sin = d => Math.sin(d * RAD), cos = d => Math.cos(d * RAD);

/**
 * Moon position for a Date. Returns degrees: right ascension and declination, azimuth clockwise from true
 * north and elevation above the horizon as seen from the site (parallax included), its hour angle (0 as it
 * crosses the meridian, growing 14.5 degrees an hour), and the lit share of its disc (0 new .. 1 full).
 */
export function moonPosition(date, lat = SITE.lat, lon = SITE.lon) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545, T = d / 36525;
  // Ecliptic longitude and latitude.
  const l = 218.32 + 481267.881 * T + 6.29 * sin(135.0 + 477198.87 * T) - 1.27 * sin(259.3 - 413335.36 * T) + 0.66 * sin(235.7 + 890534.22 * T)
    + 0.21 * sin(269.9 + 954397.74 * T) - 0.19 * sin(357.5 + 35999.05 * T) - 0.11 * sin(186.5 + 966404.03 * T);
  const b = 5.13 * sin(93.3 + 483202.02 * T) + 0.28 * sin(228.2 + 960400.89 * T) - 0.28 * sin(318.3 + 6003.15 * T) - 0.17 * sin(217.6 - 407332.21 * T);
  const eps = 23.439 - 0.0000004 * d;
  const x = cos(b) * cos(l), y = cos(eps) * cos(b) * sin(l) - sin(eps) * sin(b), z = sin(eps) * cos(b) * sin(l) + cos(eps) * sin(b);
  const ra = mod(Math.atan2(y, x) / RAD, 360), dec = Math.asin(z) / RAD;
  // Hour angle from the sidereal time at the site.
  const ha = mod(280.46061837 + 360.98564736629 * d + lon - ra, 360);
  let elevation = Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(ha)) / RAD;
  const azimuth = mod(Math.atan2(sin(ha), cos(ha) * sin(lat) - Math.tan(dec * RAD) * cos(lat)) / RAD + 180, 360);
  elevation -= 0.95 * cos(elevation);                       // the moon is near: seen from the surface it stands almost a degree lower
  // The lit share, from how far round the sky it is from the sun.
  const M = 357.529 + 35999.05 * T, sun = 280.459 + 36000.77 * T + 1.915 * sin(M) + 0.02 * sin(2 * M);
  return { ra, dec, azimuth, elevation, hourAngle: ha, illuminated: (1 - cos(b) * cos(l - sun)) / 2 };
}

/** The day of a month ('YYYY-MM-DD') on which the moon is fullest at local midnight. `month` 0-11. */
export function fullMoonDay(year, month, utcOffsetHours = SITE.utcOffsetHours) {
  let best = 1, lit = -1;
  for (let day = 1; day <= 28; day++) {
    const k = moonPosition(new Date(Date.UTC(year, month, day, 24 - utcOffsetHours))).illuminated;
    if (k > lit) { lit = k; best = day; }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(best).padStart(2, '0')}`;
}

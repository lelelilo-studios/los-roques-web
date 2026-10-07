// Where the sun is, for any date and time at Los Roques (NOAA's low-precision solar position algorithm,
// good to a few hundredths of a degree). No imports: also used by the Node tests.

export const SITE = { lat: 11.85, lon: -66.75, utcOffsetHours: -4 };   // Venezuela is UTC-4 all year

const RAD = Math.PI / 180;
const mod = (v, m) => ((v % m) + m) % m;

function solar(date) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + 0.0003032 * T), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eqTime };   // radians, minutes
}

/**
 * Sun position for a Date. Returns degrees: azimuth clockwise from true north, elevation above the horizon
 * (geometric, no refraction), plus the declination.
 */
export function sunPosition(date, lat = SITE.lat, lon = SITE.lon) {
  const { decl, eqTime } = solar(date);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  const ha = (mod(minutes + eqTime + 4 * lon, 1440) / 4 - 180) * RAD;
  const sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD);
  const elevation = Math.asin(sl * Math.sin(decl) + cl * Math.cos(decl) * Math.cos(ha));
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * sl - Math.tan(decl) * cl) + Math.PI;
  return { azimuth: mod(azimuth / RAD, 360), elevation: elevation / RAD, declination: decl / RAD };
}

/** Sunrise, solar noon and sunset of the local day containing `date`, as local clock hours (UTC-4). */
export function sunTimes(date, lat = SITE.lat, lon = SITE.lon, utcOffsetHours = SITE.utcOffsetHours) {
  const { decl, eqTime } = solar(date);
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  const h0 = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD;
  const noon = (720 - 4 * lon - eqTime) / 60 + utcOffsetHours;
  return { sunrise: noon - h0 / 15, noon, sunset: noon + h0 / 15, dayLength: 2 * h0 / 15 };
}

/** A Date for a local clock time at the site. `day` = 'YYYY-MM-DD', `hours` = local hours (may be fractional). */
export function localDate(day, hours, utcOffsetHours = SITE.utcOffsetHours) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + (hours - utcOffsetHours) * 3600000);
}

/** Unit vector towards the sun in the world frame (+x east, +y up, +z south). `convergence`: grid north vs true north, degrees. */
export function sunDirection(azimuthDeg, elevationDeg, convergenceDeg = 0) {
  const az = (azimuthDeg - convergenceDeg) * RAD, el = elevationDeg * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

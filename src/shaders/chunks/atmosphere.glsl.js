// Physically based sky (Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique"),
// ported from the WGSL of realistic-water-fluids. Distances in km in the atmosphere frame: planet centre at the
// origin, sea level at radius ATMO_BOTTOM. Three small LUTs: transmittance, multiple scattering, and the sky as
// seen from the camera ("sky view"); radiances are per unit of sun irradiance and get scaled by uSunToa.
export default /* glsl */`
#ifndef LR_ATMOSPHERE
#define LR_ATMOSPHERE
uniform sampler2D tTransmittance;   // 256 x 64
uniform sampler2D tMultiScatter;    // 32 x 32
uniform sampler2D tSkyView;         // 192 x 108
uniform float uMieScale;            // amount of haze (1 = clear maritime air)
uniform vec3 uSunToa;               // sun irradiance above the atmosphere
uniform sampler2D tEnv;             // the sky with its clouds: a panorama of the upper half (world/env.js)

const float ATMO_BOTTOM = 6360.0;
const float ATMO_TOP = 6460.0;
const vec3 RAYLEIGH_SCATTER = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float MIE_SCATTER = 3.996e-3;
const float MIE_ABSORB = 0.444e-3;
const vec3 OZONE_ABSORB = vec3(0.650e-3, 1.881e-3, 0.085e-3);
const vec3 GROUND_ALBEDO = vec3(0.06, 0.09, 0.12);     // open sea

// Nearest intersection of a ray with a sphere centred on the origin, or -1.
float lrRaySphere(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd), c = dot(ro, ro) - radius * radius, disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc), t0 = -b - s, t1 = -b + s;
  return t0 >= 0.0 ? t0 : (t1 >= 0.0 ? t1 : -1.0);
}

void lrMedium(vec3 p, out vec3 rayleigh, out float mie, out vec3 extinction) {
  float h = max(length(p) - ATMO_BOTTOM, 0.0);
  float dM = exp(-h / 1.2) * uMieScale;
  rayleigh = RAYLEIGH_SCATTER * exp(-h / 8.0);
  mie = MIE_SCATTER * dM;
  extinction = rayleigh + (MIE_SCATTER + MIE_ABSORB) * dM + OZONE_ABSORB * max(0.0, 1.0 - abs(h - 25.0) / 15.0);
}

float lrRayleighPhase(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
// Cornette-Shanks, g = 0.8.
float lrMiePhase(float c) {
  const float g = 0.8, g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2) * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

// Distance to the top of the atmosphere from radius r along a direction with zenith cosine mu.
float lrDistToTop(float r, float mu) {
  return max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + ATMO_TOP * ATMO_TOP, 0.0)));
}
vec2 lrTransmittanceUV(float r, float mu) {
  float h = sqrt(ATMO_TOP * ATMO_TOP - ATMO_BOTTOM * ATMO_BOTTOM), rho = sqrt(max(0.0, r * r - ATMO_BOTTOM * ATMO_BOTTOM));
  float dMin = ATMO_TOP - r, dMax = rho + h;
  return vec2((lrDistToTop(r, mu) - dMin) / (dMax - dMin), rho / h);
}
vec2 lrTransmittanceParams(vec2 uv) {
  float h = sqrt(ATMO_TOP * ATMO_TOP - ATMO_BOTTOM * ATMO_BOTTOM), rho = h * uv.y, r = sqrt(rho * rho + ATMO_BOTTOM * ATMO_BOTTOM);
  float dMin = ATMO_TOP - r, d = dMin + uv.x * (rho + h - dMin);
  return vec2(r, d > 0.0 ? clamp((h * h - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0) : 1.0);
}
vec3 lrTransmittanceToSun(vec3 p, vec3 sunDir) {
  if (lrRaySphere(p, sunDir, ATMO_BOTTOM) > 0.0) return vec3(0.0);        // in the planet's shadow
  float r = length(p);
  return textureLod(tTransmittance, lrTransmittanceUV(r, dot(p / r, sunDir)), 0.0).rgb;
}
vec3 lrMultiScatter(vec3 p, vec3 sunDir) {
  float r = length(p);
  vec2 uv = vec2(dot(p / r, sunDir) * 0.5 + 0.5, clamp((r - ATMO_BOTTOM) / (ATMO_TOP - ATMO_BOTTOM), 0.0, 1.0));
  return textureLod(tMultiScatter, (uv * 31.0 + 0.5) / 32.0, 0.0).rgb;
}

// A point 'heightM' metres above the sea, in the atmosphere frame.
vec3 lrAtmoPos(float heightM) { return vec3(0.0, ATMO_BOTTOM + max(heightM * 1e-3, 0.0005), 0.0); }

// In-scattered radiance (per unit sun irradiance) and transmittance along a ray, single + multiple scattering.
void lrScatter(vec3 p0, vec3 dir, vec3 sunDir, float tMax, int steps, out vec3 lum, out vec3 trans) {
  lum = vec3(0.0); trans = vec3(1.0);
  float tTop = lrRaySphere(p0, dir, ATMO_TOP), tGround = lrRaySphere(p0, dir, ATMO_BOTTOM);
  if (tTop > 0.0) tMax = min(tMax, tTop);
  if (tGround > 0.0) tMax = min(tMax, tGround);
  if (tMax <= 0.0) return;
  float c = dot(dir, sunDir), phR = lrRayleighPhase(c), phM = lrMiePhase(c), tPrev = 0.0;
  for (int i = 0; i < steps; i++) {
    float s = (float(i) + 0.3) / float(steps), t = tMax * s * s, dt = t - tPrev;
    tPrev = t;
    vec3 p = p0 + dir * t, rayleigh, extinction;
    float mie;
    lrMedium(p, rayleigh, mie, extinction);
    vec3 stepT = exp(-extinction * dt);
    vec3 scatter = lrTransmittanceToSun(p, sunDir) * (rayleigh * phR + mie * phM) + lrMultiScatter(p, sunDir) * (rayleigh + mie);
    lum += trans * (scatter - scatter * stepT) / max(extinction, vec3(1e-7));
    trans *= stepT;
  }
}

// Sky-view LUT mapping: u = azimuth relative to the sun, v = elevation squeezed towards the horizon.
vec2 lrSkyViewUV(vec3 d, vec3 sunDir) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.z, d.x) - atan(sunDir.z, sunDir.x);
  return vec2(fract(az / (2.0 * PI)), 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (0.5 * PI)));
}
vec3 lrSkyViewDir(vec2 uv, vec3 sunDir) {
  float s = uv.y * 2.0 - 1.0, elev = sign(s) * s * s * 0.5 * PI, az = uv.x * 2.0 * PI + atan(sunDir.z, sunDir.x);
  return vec3(cos(elev) * cos(az), sin(elev), cos(elev) * sin(az));
}

// Radiance of the clear sky in direction d, as seen from the camera.
vec3 lrSkyRadiance(vec3 d) {
  vec2 uv = lrSkyViewUV(d, uSunDir);
  uv.y = clamp(uv.y, 0.5 / 108.0, 1.0 - 0.5 / 108.0);
  return uSunToa * textureLod(tSkyView, uv, 0.0).rgb;
}

// The sky with its clouds in direction d (taken into the upper half), as a surface whose slopes vary by 'var'
// mirrors it: the rougher, the more blurred.
vec3 lrEnv(vec3 d, float var) {
  vec2 uv = vec2(atan(d.x, -d.z) * 0.15915494, sqrt(asin(clamp(abs(d.y), 0.0, 1.0)) * 0.63661977));
  return textureLod(tEnv, uv, log2(max(4.0 * sqrt(var) / 0.0123, 1.0))).rgb;
}

// What the air does to light coming from 'dist' metres away in direction 'dir': dims it and adds its own glow.
#ifndef LR_AP_STEPS
#define LR_AP_STEPS 6
#endif
vec3 lrAerial(vec3 col, vec3 dir, float dist) {
  vec3 lum, trans;
  lrScatter(lrAtmoPos(uCamY), dir, uSunDir, dist * 1e-3, LR_AP_STEPS, lum, trans);
  return col * trans + uSunToa * lum;
}
#endif
`;

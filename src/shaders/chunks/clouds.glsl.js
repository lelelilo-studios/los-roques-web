// Trade-wind cumulus as a volumetric layer on the round Earth, ported from the WGSL of realistic-water-fluids:
// density = Perlin-Worley shapes cut by a drifting coverage pattern and a cumulus height profile, eroded by
// Worley detail; sunlight by a short march towards the sun with multiple-scattering octaves (Wrenninge) and a
// two-lobe phase function; sky light as ambient. Needs lr_common and lr_atmosphere.
export const cloudShadowGLSL = /* glsl */`
#ifndef LR_CLOUD_SHADOW
#define LR_CLOUD_SHADOW
uniform sampler2D tCloudShadow;   // how much sunlight gets through the cloud layer to the ground
uniform vec4 uCloudShadow;        // xy = world xz of the map's corner, z = 1 / size, w = 1 when clouds are on
float lrCloudShadow(vec2 wxz) {
  if (uCloudShadow.w < 0.5) return 1.0;
  vec2 uv = (wxz - uCloudShadow.xy) * uCloudShadow.z, e = abs(uv - 0.5) * 2.0;
  return mix(textureLod(tCloudShadow, uv, 0.0).r, 1.0, smoothstep(0.9, 1.0, max(e.x, e.y)));
}
#endif
`;

export default /* glsl */`
#ifndef LR_CLOUDS
#define LR_CLOUDS
uniform highp sampler3D tCloudShape;    // R = Perlin-Worley, GBA = Worley octaves
uniform highp sampler3D tCloudDetail;   // RGB = Worley octaves
uniform vec4 uCloudLayer;               // base altitude, top altitude (m), coverage 0..1, extinction (1/m) at density 1
uniform vec4 uCloudWind;                // xy = drift so far (m), z = shape tile (m), w = detail tile (m)
const float CLOUD_R = 6360000.0;
const float CLOUD_WEATHER_TILE = 38000.0;

// Height above the sea of a point given relative to the camera's ground position (x, altitude, z).
float lrCloudAltitude(vec3 p) { return length(p + vec3(0.0, CLOUD_R, 0.0)) - CLOUD_R; }
// Ray against the sphere 'alt' metres above the sea: (near, far), or (-1, -1).
vec2 lrCloudShell(vec3 o, vec3 d, float alt) {
  vec3 c = o + vec3(0.0, CLOUD_R, 0.0);
  float r = CLOUD_R + alt, b = dot(c, d), h = b * b - (dot(c, c) - r * r);
  if (h < 0.0) return vec2(-1.0);
  float s = sqrt(h);
  return vec2(-b - s, -b + s);
}
float lrRemap(float v, float lo, float hi, float nlo, float nhi) { return nlo + (v - lo) / max(hi - lo, 1e-5) * (nhi - nlo); }

// Cloud density (0..1) at p (camera-relative x/z, altitude in y). 'detail' adds the fine erosion; 'size' is how
// large a region the sample stands for (metres): distant clouds read coarser mips of the noise instead of aliasing.
float lrCloudDensity(vec3 p, bool detail, float size) {
  float alt = lrCloudAltitude(p), hf = (alt - uCloudLayer.x) / (uCloudLayer.y - uCloudLayer.x);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec2 wxz = uCamXZ + p.xz;
  // Where there are clouds at all: a slow, large pattern drifting at half the wind.
  // (Two scales of the noise: one alone, stretched over 38 km, shows its texels as blocky cloud edges.)
  vec2 wp = wxz + uCloudWind.xy * 0.5;
  vec4 w = textureLod(tCloudShape, vec3(wp / CLOUD_WEATHER_TILE, 0.37), 0.0);
  vec4 w2 = textureLod(tCloudShape, vec3(mat2(0.8, -0.6, 0.6, 0.8) * wp / 16700.0 + 0.31, 0.71), 0.0);   // turned, so the two do not repeat together
  float cov = lrSaturate(lrRemap(w.r * 0.55 + w.g * 0.15 + w2.r * 0.3, 1.0 - uCloudLayer.z * 1.1, 1.0, 0.0, 1.0));
  if (cov <= 0.0) return 0.0;
  vec3 q = vec3(wxz.x + uCloudWind.x, alt, wxz.y + uCloudWind.y);
  // (Not past mip 2: coarser than that the cumulus shapes themselves blur into a sheet.)
  vec4 s = textureLod(tCloudShape, q / uCloudWind.z, min(log2(max(size * 128.0 / uCloudWind.z, 1.0)), 2.0));
  float fbm = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  // Cumulus profile: a flat rounded base, a towering but tapering top.
  float base = lrRemap(s.r, fbm - 1.0, 1.0, 0.0, 1.0) * smoothstep(0.0, 0.08, hf) * smoothstep(1.0, 0.35, hf);
  base = lrSaturate(lrRemap(base, 1.0 - cov, 1.0, 0.0, 1.0)) * cov;
  if (base <= 0.0 || !detail) return base;
  vec4 dn = textureLod(tCloudDetail, (q + vec3(0.0, -uCloudWind.x * 0.3, 0.0)) / uCloudWind.w, log2(max(size * 32.0 / uCloudWind.w, 1.0)));
  float dfbm = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
  return lrSaturate(lrRemap(base, mix(dfbm, 1.0 - dfbm, lrSaturate(hf * 5.0)) * 0.4, 1.0, 0.0, 1.0));   // wispy below, billowy above
}

float lrHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }

// Optical depth from p towards the sun (a few growing steps).
float lrCloudSunDepth(vec3 p, int steps, float size) {
  float t = 0.0, stepLen = 80.0, tau = 0.0;
  for (int i = 0; i < steps; i++) {
    t += stepLen;
    tau += lrCloudDensity(p + uSunDir * (t - 0.5 * stepLen), false, max(size, stepLen * 0.5)) * stepLen;
    stepLen *= 2.2;
  }
  return tau * uCloudLayer.w;
}

// Marches the layer along a ray from the camera. Returns radiance in rgb and transmittance in a;
// 'dist' is the transmittance-weighted distance to the cloud (for the haze in front of it).
// 'pixel' is the angle one pixel of the cloud image covers (radians).
vec4 lrCloudMarch(vec3 o, vec3 d, float jitter, int steps, int lightSteps, float maxDist, float pixel, out float dist) {
  dist = 0.0;
  float alt = lrCloudAltitude(o), t0, t1;
  vec2 base = lrCloudShell(o, d, uCloudLayer.x), top = lrCloudShell(o, d, uCloudLayer.y);
  if (alt < uCloudLayer.x) { if (base.y <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0); t0 = base.y; t1 = top.y; }
  else if (alt < uCloudLayer.y) { t0 = 0.0; t1 = base.x > 0.0 ? base.x : top.y; }
  else { if (top.x <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0); t0 = top.x; t1 = base.x > 0.0 ? base.x : top.y; }
  t1 = min(t1, min(t0 + 60000.0, maxDist));
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float dt = (t1 - t0) / float(steps), phase0 = mix(lrHG(dot(d, uSunDir), -0.2), lrHG(dot(d, uSunDir), 0.75), 0.7);
  // Sunlight reaching the layer through the air above it, and the sky's light from all around.
  vec3 sun = uSunToa * lrTransmittanceToSun(lrAtmoPos(0.5 * (uCloudLayer.x + uCloudLayer.y)), uSunDir);
  vec3 ambient = uSkyE / PI * 1.1;
  // (Light that has been scattered about inside a cloud has lost most of the sky's blue; and the bases are lit
  // from below, by the bright shallows and sand. Without these the undersides of far cumulus were mauve.)
  ambient = mix(ambient, vec3(lrLuma(ambient)), 0.5);
  vec3 bounce = (uSunE * lrSaturate(uSunDir.y) + uSkyE) / PI * vec3(0.11, 0.14, 0.15);
  vec3 radiance = vec3(0.0);
  float trans = 1.0, weight = 0.0, t = t0 + dt * jitter;
  for (int i = 0; i < steps; i++) {
    vec3 p = o + d * t;
    // Far-off cumulus cannot be resolved by a march this coarse (they smear into grey sheets): let them thin out
    // into the haze between 22 and 45 km.
    float size = max(t * pixel, dt * 0.5), dens = lrCloudDensity(p, true, size) * (1.0 - smoothstep(22000.0, 45000.0, t));
    if (dens > 0.0) {
      float sigma = dens * uCloudLayer.w, tauSun = lrCloudSunDepth(p, lightSteps, size);
      // Multiple scattering as octaves: each order sees less extinction and a flatter phase function.
      float sunTerm = 0.0, a = 1.0, b = 1.0, c = 1.0;
      for (int k = 0; k < 4; k++) { sunTerm += a * exp(-tauSun * b) * mix(1.0 / (4.0 * PI), phase0, c); a *= 0.6; b *= 0.3; c *= 0.55; }
      float powder = 1.0 - exp(-2.0 * sigma * 60.0);
      float hf = (lrCloudAltitude(p) - uCloudLayer.x) / (uCloudLayer.y - uCloudLayer.x);
      vec3 s = sun * sunTerm * mix(0.7, 1.0, powder) + ambient * (0.5 + 0.5 * hf) + bounce * (1.0 - hf);
      float stepT = exp(-sigma * dt), absorbed = trans * (1.0 - stepT);
      radiance += s * absorbed;
      dist += absorbed * t; weight += absorbed;
      trans *= stepT;
      if (trans < 0.01) break;
    }
    t += dt;
  }
  dist = weight > 1e-4 ? dist / weight : t0;
  return vec4(radiance, trans);
}
#endif
`;

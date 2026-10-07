// Water colour and tone mapping.
export default /* glsl */`
#ifndef LR_OPTICS
#define LR_OPTICS
uniform vec3 uAbsOcean;     // absorption a (1/m) for R, G, B: clear ocean water outside the reef
uniform vec3 uBbOcean;      // backscattering bb (1/m)
uniform vec3 uAbsLagoon;    // the lagoon is slightly more turbid
uniform vec3 uBbLagoon;

// Remote-sensing reflectance just above shallow water (Lee et al. 1998/1999), per colour band:
// what leaves the sea per unit of light arriving, for a bottom of reflectance 'rho' under 'H' metres of water.
// muS / muV are the cosines of the sun and view directions under water. The offline pipeline inverts this same
// formula to get the depth and bottom maps, so rendering them back reproduces the satellite picture.
vec3 lrWaterRrs(vec3 rho, float H, float muS, float muV, vec3 a, vec3 bb) {
  vec3 k = a + bb, u = bb / k;
  vec3 duC = 1.03 * sqrt(1.0 + 2.4 * u), duB = 1.04 * sqrt(1.0 + 5.4 * u);
  vec3 rrsDeep = (0.084 + 0.170 * u) * u;
  vec3 rrs = rrsDeep * (1.0 - exp(-(1.0 / muS + duC / muV) * k * H)) + rho / PI * exp(-(1.0 / muS + duB / muV) * k * H);
  // (The denominator is light bounced back down by the surface and up again: it follows the bed's ordinary
  // brightness, not the lines where the waves focus the sun to several times that, so it is held there.)
  return 0.52 * rrs / (1.0 - 1.7 * min(rrs, 0.33));
}

// Cosine of a direction after refraction into water, from its cosine in air.
float lrCosInWater(float muAir) { return sqrt(1.0 - (1.0 - muAir * muAir) / (1.34 * 1.34)); }

// Fresnel reflectance of the air-water surface (Schlick, F0 = 0.021).
float lrFresnel(float cosTheta) { return 0.021 + 0.979 * pow(1.0 - lrSaturate(cosTheta), 5.0); }

// Past 15-20 m the satellite cannot see the bottom and the depth map is only an estimate, so from there on the
// sea is treated as bottomless (no faint picture of a made-up seabed in the open ocean).
float lrOpticalDepth(float H) { return H + smoothstep(16.0, 32.0, H) * 2000.0; }

// Sun reflected by a surface whose slopes are Gaussian with variance 'var' (x, z) about the mean normal N
// (Ross, Dion & Potvin 2005, as used by Bruneton et al. 2010). Returns radiance per unit sun irradiance.
float lrSunGlitter(vec3 V, vec3 N, vec3 L, vec2 var) {
  vec3 H = normalize(L + V), Ty = normalize(cross(N, vec3(1.0, 0.0, 0.0))), Tx = cross(Ty, N);
  float zH = max(dot(H, N), 1e-3), zx = dot(H, Tx) / zH, zy = dot(H, Ty) / zH;
  float p = exp(-0.5 * (zx * zx / var.x + zy * zy / var.y)) / (2.0 * PI * sqrt(var.x * var.y));
  float fresnel = 0.021 + 0.979 * pow(1.0 - lrSaturate(dot(V, H)), 5.0);
  return fresnel * p / (4.0 * max(dot(V, N), 0.06) * zH * zH * zH * zH);
}
// Fresnel reflectance averaged over a rough sea surface with slope deviation sigma (Bruneton et al. 2010).
float lrMeanFresnel(float cosV, float sigma) {
  return 0.02 + 0.98 * pow(1.0 - cosV, 5.0 * exp(-2.69 * sigma)) / (1.0 + 22.7 * pow(sigma, 1.5));
}

// AgX (Troy Sobotka), minimal fit by Benjamin Wrensch, with a punchier look. Linear Rec.709 in, display out.
vec3 lrAgxCurve(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 lrTonemap(vec3 c, float saturation) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = inM * max(c, 0.0);
  c = clamp(log2(max(c, 1e-10)), -12.47393, 4.026069);
  c = lrAgxCurve((c + 12.47393) / 16.5);
  c = pow(max(c, 0.0), vec3(1.2));
  float l = lrLuma(c);
  c = l + saturation * (c - l);
  return clamp(outM * c, 0.0, 1.0);
}
#endif
`;

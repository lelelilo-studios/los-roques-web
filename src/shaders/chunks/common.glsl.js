// Shared by every shader: frame uniforms, the world frame, depth helpers.
//
// World frame: +x east, +y up, +z south, metres. Geometry is rendered relative to the camera's horizontal
// position ("rel" = world xz - uCamXZ; y is absolute), which keeps beach close-ups steady 20 km from the origin.
// `uCamXZ + rel` is good for map lookups only; fine patterns use lrDetailXZ(), which wraps before adding.
export default /* glsl */`
#ifndef LR_COMMON
#define LR_COMMON
#define PI 3.14159265359

uniform vec2 uCamXZ;        // camera position east/south (true world metres)
uniform vec4 uCamMod;       // camera xz wrapped to 64 m (xy) and 1024 m (zw), computed in doubles
uniform float uCamY;        // camera height above mean sea level
uniform vec4 uMapRect;      // xy = world xz of the map's north-west corner, zw = 1 / size
uniform float uSeaLevel;    // sea surface height (tide, live sea level)
uniform float uTime;
uniform float uInvEarthR;   // 0 switches the curvature off
uniform vec3 uSunDir;       // towards the sun
uniform vec3 uSunE;         // sun irradiance on a surface facing it, after the atmosphere
uniform vec3 uSkyE;         // sky irradiance on a horizontal surface
uniform vec2 uNearFar;
uniform vec2 uInvResolution;

vec2 lrMapUV(vec2 wxz) { return (wxz - uMapRect.xy) * uMapRect.zw; }

// Pattern coordinates for detail finer than a few centimetres: exact near the camera, periodic in 64 m / 1024 m.
vec2 lrDetailXZ(vec2 rel) { return rel + uCamMod.xy; }
vec2 lrDetailXZFar(vec2 rel) { return rel + uCamMod.zw; }

// How far the spherical Earth has dropped below the tangent plane at horizontal distance |rel|.
float lrCurveDrop(vec2 rel) { return dot(rel, rel) * 0.5 * uInvEarthR; }

// Distance along the view axis from a depth-buffer value.
float lrViewZ(float depth) {
  float n = uNearFar.x, f = uNearFar.y;
#ifdef USE_REVERSED_DEPTH_BUFFER
  return n * f / (depth * (f - n) + n);
#else
  return 2.0 * n * f / (f + n - (depth * 2.0 - 1.0) * (f - n));
#endif
}
bool lrIsSky(float depth) {
#ifdef USE_REVERSED_DEPTH_BUFFER
  return depth <= 0.0;
#else
  return depth >= 1.0;
#endif
}

float lrSaturate(float v) { return clamp(v, 0.0, 1.0); }
float lrLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Cheap hashes (no trig, stable across GPUs).
float lrHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 lrHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float lrNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lrHash12(i), lrHash12(i + vec2(1.0, 0.0)), u.x), mix(lrHash12(i + vec2(0.0, 1.0)), lrHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lrFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * lrNoise(p); p = p * 2.03 + 17.7; a *= 0.5; }
  return s / 0.9375;
}
#endif
`;

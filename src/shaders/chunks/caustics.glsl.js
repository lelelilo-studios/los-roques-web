// The sun's light at a point in the sea, focused and spread by the waves above it: for things in the water (your
// own body, plants, animals), which the seabed's own fuller version (world/terrain.js lrCaustics) does not
// reach. The waves are taken as high as they are where the camera is (uWaveHere): what is lit by this is near.
// Needs lr_common, and the uniforms in CAUSTIC_UNIFORMS; not for a shader that already has world/waves.js's GLSL.
export const CAUSTIC_UNIFORMS = ['tWaveC', 'uWaveTile', 'uWaveCamMod', 'uWaveCurve', 'uWaveHere'];
export default /* glsl */`
uniform highp sampler2DArray tWaveC;   // curvature of the wave cascades
uniform vec4 uWaveTile;
uniform vec2 uWaveCamMod[4];
uniform vec4 uWaveCurve;
uniform vec4 uWaveHere;                // height of each cascade's waves where the camera is
// rel: the point's x, z relative to the camera; water: how far under the surface it is (m). 1 = as much light
// as a flat sea would let down; more where the waves focus it, less between.
float lrCausticsHere(vec2 rel, float water) {
  vec3 s = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.34);
  float path = water / max(-s.y, 0.3), kd = 0.254 * path, blur = path * 0.0093 + 0.012;
  vec2 entry = rel - s.xz * path;
  vec3 h = vec3(0.0);
  for (int i = 1; i < 4; i++) {
    float w = uWaveHere[i], bend = kd * w * uWaveCurve[i];
    h += w / (1.0 + bend * bend) * textureLod(tWaveC, vec3((entry + uWaveCamMod[i]) / uWaveTile[i], float(i)), log2(max(blur * 256.0 / uWaveTile[i], 1.0))).xyz;
  }
  float bright = min(1.0 / max(abs((1.0 + kd * h.x) * (1.0 + kd * h.y) - kd * kd * h.z * h.z), 0.25), 3.0);
  // (Just under the surface there is no pattern yet: it comes in over the first hand's breadth.)
  return mix(1.0, bright, smoothstep(0.02, 0.3, water) * step(0.02, uSunDir.y));
}`;

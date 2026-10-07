// The uniforms every material shares. Materials reference these same { value } objects, so one write per frame
// reaches all of them.
import * as THREE from 'three';
import { EARTH_RADIUS } from '../config.js';

export const shared = {
  uCamXZ: { value: new THREE.Vector2() },
  uCamMod: { value: new THREE.Vector4() },
  uCamY: { value: 100 },
  uFocusRel: { value: new THREE.Vector2() },
  uMapRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uMapTexels: { value: new THREE.Vector4(1, 1, 1, 1) },
  uMpp: { value: 11 },
  tDetail: { value: null },
  uDetailMean: { value: [new THREE.Vector4(0.5, 0.5, 0.5, 0.5), new THREE.Vector4(0.5, 0.5, 0.5, 0.5), new THREE.Vector4(0.5, 0.5, 0.5, 0.5)] },
  uFoot: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 0, -1e9)) },   // your footprints: x, z (wrapped to 64 m), heading, time made
  uFootCount: { value: 0 },
  uRing: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -1e9, 0)) },     // rings you send out wading: x, z (wrapped to 64 m), time, strength
  tShadow: { value: null }, uShadowC: { value: new THREE.Vector3() }, uShadowR: { value: new THREE.Vector3(1, 0, 0) }, uShadowU: { value: new THREE.Vector3(0, 0, 1) },
  uShadowP: { value: new THREE.Vector4(1, 1, 0, 0) },
  uCamTexel: { value: new THREE.Vector4() },
  uCamTexelShore: { value: new THREE.Vector4() },
  uLift: { value: new THREE.Vector2(2e-4, 0) },   // how far the sea's mesh rides above the beach face: per metre, per metre squared
  uSeaLevel: { value: 0 },
  uTime: { value: 0 },
  uInvEarthR: { value: 1 / EARTH_RADIUS },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
  uSunE: { value: new THREE.Vector3(3.0, 2.9, 2.7) },
  uSkyE: { value: new THREE.Vector3(0.35, 0.5, 0.75) },
  uSunToa: { value: new THREE.Vector3(10, 10, 10) },         // sun irradiance above the atmosphere (sets the scene's scale)
  uMieScale: { value: 1 },
  tTransmittance: { value: null }, tMultiScatter: { value: null }, tSkyView: { value: null }, tEnv: { value: null },
  uNearFar: { value: new THREE.Vector2(0.1, 200000) },
  uInvResolution: { value: new THREE.Vector2(1, 1) },
  // Water optics (1/m; R, G, B). Starting values; the data manifest and the validation pass refine them.
  uAbsOcean: { value: new THREE.Vector3(0.265, 0.058, 0.012) },
  uBbOcean: { value: new THREE.Vector3(0.0011, 0.0015, 0.0024) },
  uAbsLagoon: { value: new THREE.Vector3(0.266, 0.063, 0.030) },
  uBbLagoon: { value: new THREE.Vector3(0.008, 0.009, 0.010) },
  // Map textures (set by the loader).
  tHeight: { value: null }, tShore: { value: null }, tAlbedo: { value: null },
  tBenthic: { value: null }, tLand: { value: null }, tWaveMap: { value: null }, tSatellite: { value: null }, tWaterType: { value: null },
  // Waves (set by world/waves.js).
  tWaveA: { value: null }, tWaveB: { value: null }, tWaveC: { value: null }, tWaveLUT: { value: null },
  uWaveTile: { value: new THREE.Vector4(499, 97, 19, 3.7) },
  uWaveCurve: { value: new THREE.Vector4(1, 1, 1, 1) },
  uWaveHere: { value: new THREE.Vector4() },
  uTreesNear: { value: 0 },                                // 1 when mangroves are drawn as trees near the eye (the canopy shell gives way)
  uWaveCamMod: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  uWind: { value: new THREE.Vector3(-0.97, 0.26, 7) },
  uViewProj: { value: new THREE.Matrix4() },                  // of the camera-relative frame
  // Clouds (set by world/clouds.js).
  tCloudShape: { value: null }, tCloudDetail: { value: null }, tCloudShadow: { value: null },
  uCloudLayer: { value: new THREE.Vector4(650, 1750, 0, 0.04) },
  uCloudWind: { value: new THREE.Vector4(0, 0, 6500, 650) },
  uCloudShadow: { value: new THREE.Vector4(0, 0, 1, 0) },
  // Screen-space split for the satellite comparison: pixels left of this x (0..1) show the satellite picture; < 0 = off.
  uCompareX: { value: -1 },
  // Camera basis for full-screen passes: xyz = axis, scaled by tan(fov/2) (and aspect for the right vector).
  uCamRight: { value: new THREE.Vector3(1, 0, 0) },
  uCamUp: { value: new THREE.Vector3(0, 1, 0) },
  uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
  uExposure: { value: 1 },
  uUnderEye: { value: 0 },
  uRain: { value: 0 },                                        // 0 dry .. 1 a downpour
  uDebug: { value: new THREE.Vector4() },                     // x: debug view of the water pass (0 = off)
};

/** Picks shared uniforms by name and adds material-specific ones. */
export function uniformsFor(names, own = {}) {
  const u = { ...own };
  for (const n of names) { if (!shared[n]) throw new Error(`unknown shared uniform ${n}`); u[n] = shared[n]; }
  return u;
}

/** Names that the chunks declare, grouped by chunk, so materials list what they include. */
export const CHUNK_UNIFORMS = {
  common: ['uCamXZ', 'uCamMod', 'uCamY', 'uMapRect', 'uSeaLevel', 'uTime', 'uInvEarthR', 'uSunDir', 'uSunE', 'uSkyE', 'uNearFar', 'uInvResolution'],
  geo: ['tHeight', 'tShore', 'uMapTexels', 'uMpp', 'uCamTexel', 'uCamTexelShore'],
  shore: ['uLift'],
  detail: ['tDetail', 'uDetailMean', 'uFoot', 'uFootCount'],
  rings: ['uRing'],
  shadow: ['tShadow', 'uShadowC', 'uShadowR', 'uShadowU', 'uShadowP'],
  optics: ['uAbsOcean', 'uBbOcean', 'uAbsLagoon', 'uBbLagoon'],
  atmosphere: ['tTransmittance', 'tMultiScatter', 'tSkyView', 'uMieScale', 'uSunToa', 'tEnv'],
  clouds: ['tCloudShape', 'tCloudDetail', 'uCloudLayer', 'uCloudWind'],
  cloudShadow: ['tCloudShadow', 'uCloudShadow'],
};

// Registers the shared GLSL chunks with three, so shaders can `#include <lr_common>` etc.
import * as THREE from 'three';
import common from '../shaders/chunks/common.glsl.js';
import geo from '../shaders/chunks/geo.glsl.js';
import optics from '../shaders/chunks/optics.glsl.js';
import atmosphere from '../shaders/chunks/atmosphere.glsl.js';
import shore from '../shaders/chunks/shore.glsl.js';
import clouds, { cloudShadowGLSL } from '../shaders/chunks/clouds.glsl.js';

export function registerChunks() {
  Object.assign(THREE.ShaderChunk, { lr_common: common, lr_geo: geo, lr_optics: optics, lr_atmosphere: atmosphere, lr_shore: shore, lr_clouds: clouds, lr_cloud_shadow: cloudShadowGLSL });
}

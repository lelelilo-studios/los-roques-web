// The WebGL renderer and the off-screen targets of the frame.
// Everything is rendered in linear HDR (half float); the last pass tone-maps to the canvas. three is used for
// draw calls, state and targets only: no three lights, tone mapping or colour conversion.
import * as THREE from 'three';
import { params } from '../config.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance',
    reversedDepthBuffer: params.revz,
  });
  renderer.autoClear = false;
  renderer.sortObjects = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the final pass writes display values itself
  renderer.info.autoReset = false;

  const reversed = renderer.capabilities.reversedDepthBuffer === true;
  const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, stencilBuffer: false, generateMipmaps: false };
  // Reversed depth wants a float depth buffer; the ordinary path uses 24-bit.
  const depthTexture = new THREE.DepthTexture(1, 1, reversed ? THREE.FloatType : THREE.UnsignedIntType);
  depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
  const targets = {
    scene: new THREE.WebGLRenderTarget(1, 1, { ...hdr, depthBuffer: true, depthTexture, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
    refr: new THREE.WebGLRenderTarget(1, 1, { ...hdr, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
    hdr: new THREE.WebGLRenderTarget(1, 1, { ...hdr, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
    // Display-ready colour with luma in alpha, for the anti-aliasing pass.
    ldr: new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
  };

  const size = { width: 1, height: 1, cssWidth: 1, cssHeight: 1, scale: 1 };
  /** Sizes the canvas for the CSS box and the off-screen targets for `scale` times that. */
  function resize(cssWidth, cssHeight, dpr, scale = size.scale) {
    const cw = Math.max(1, Math.round(cssWidth * dpr)), ch = Math.max(1, Math.round(cssHeight * dpr));
    const w = Math.max(1, Math.round(cw * scale)), h = Math.max(1, Math.round(ch * scale));
    if (canvas.width !== cw || canvas.height !== ch) renderer.setSize(cw, ch, false);
    if (w !== size.width || h !== size.height) for (const t of Object.values(targets)) t.setSize(w, h);
    Object.assign(size, { width: w, height: h, cssWidth, cssHeight, scale, canvasWidth: cw, canvasHeight: ch });
  }
  return { renderer, targets, size, resize, reversed };
}

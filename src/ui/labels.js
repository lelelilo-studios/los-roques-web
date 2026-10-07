// Place names: plain DOM labels pinned to world positions. Bigger places show from further away; where two
// would overlap the more important one wins.
export class Labels {
  /** @param {HTMLElement} root  @param {{name: string, pos: [number, number], rank: number, area_m2: number}[]} places */
  constructor(root, places, ground) {
    this.root = root;
    this.items = places.map(p => {
      const el = document.createElement('span');
      el.className = 'place-label';
      el.textContent = p.name;
      el.hidden = true;
      root.appendChild(el);
      return { ...p, el, y: Math.max(ground ? ground.heightAt(p.pos[0], p.pos[1]) : 0, 0) + 3, size: Math.sqrt(Math.max(p.area_m2 || 1e4, 2500)), shown: false };
    }).sort((a, b) => a.rank - b.rank);
    this.enabled = true;
  }

  /**
   * @param {{x: number, y: number, z: number}} eye  camera position in world metres
   * @param {THREE.Matrix4} viewProj  of the camera-relative frame
   * @param {number} width  @param {number} height  CSS pixels
   */
  update(eye, viewProj, width, height) {
    const m = viewProj.elements, taken = [];
    for (const it of this.items) {
      let show = false, sx = 0, sy = 0;
      if (this.enabled) {
        const x = it.pos[0] - eye.x, y = it.y, z = it.pos[1] - eye.z;
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (w > 1) {
          sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * width;
          sy = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * height;
          // Shown once the place is a few pixels across (the famous ones a little sooner), and not when you are standing in it.
          const px = it.size / w * height, need = it.rank <= 3 ? 3 : it.rank <= 12 ? 9 : 22;
          show = px > need && px < height * 1.5 && sx > 20 && sx < width - 20 && sy > 20 && sy < height - 20;
          const half = it.name.length * 3.6 + 8;
          if (show) for (const t of taken) if (Math.abs(t[0] - sx) < t[2] + half && Math.abs(t[1] - sy) < 18) { show = false; break; }
          if (show) taken.push([sx, sy, half]);
        }
      }
      if (show !== it.shown) { it.el.hidden = !show; it.shown = show; }
      if (show) it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}

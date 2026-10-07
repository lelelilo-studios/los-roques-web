// Keeps the frame rate up on slow devices by lowering the render size (the picture is scaled to the canvas).
// It only sees frame intervals, so it backs off when frames come late and creeps back up when they are on time.

export class DynamicResolution {
  /** @param {number} max  largest scale allowed (1 = one render pixel per canvas pixel)  @param {number} min */
  constructor(max = 1, min = 0.5) {
    Object.assign(this, { max, min, scale: max, sum: 0, count: 0, calm: 0, refresh: 1 / 60 });
  }

  /**
   * Feed one frame interval (seconds). Returns a new scale when it should change, otherwise null.
   * Long gaps (tab in the background, a hitch while loading) are ignored.
   */
  frame(dt) {
    if (dt <= 0 || dt > 0.25) return null;
    this.sum += dt;
    if (++this.count < 40) return null;
    const mean = this.sum / this.count;
    this.sum = 0; this.count = 0;
    this.refresh = Math.min(this.refresh, Math.max(mean, 1 / 240));       // the fastest we have seen is the display's pace
    const budget = Math.max(this.refresh * 1.25, 1 / 50);
    let next = this.scale;
    if (mean > budget * 1.6) { next = this.scale * 0.75; this.calm = 0; }
    else if (mean > budget) { next = this.scale * 0.9; this.calm = 0; }
    else if (++this.calm >= 6 && this.scale < this.max) { next = this.scale * 1.08; this.calm = 3; }
    next = Math.min(this.max, Math.max(this.min, next));
    if (Math.abs(next - this.scale) < 0.02) return null;
    this.scale = next;
    return next;
  }
}

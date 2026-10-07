// Where the piers are and how you walk on them (no three here: the walker's tests use it).

/** Height of a pier's deck above mean sea level, and how steeply the gangway climbs to it from the beach. */
export const PIER_DECK = 1.14, PIER_RAMP = 0.4;

/**
 * The piers as stretches of deck: for each, the points from the landward end out, half its width, the ground at
 * the landward end and the length of the gangway that climbs from there to the deck.
 */
export function pierRuns(piers, ground) {
  const runs = [];
  for (const pier of piers || []) {
    const line = pier.line || [];
    if (line.length < 2) continue;
    const first = line[0], last = line[line.length - 1];
    // (The landward end is the higher one.)
    const pts = ground.heightAt(first[0], first[1]) >= ground.heightAt(last[0], last[1]) ? line : [...line].reverse();
    const g0 = Math.min(Math.max(ground.heightAt(pts[0][0], pts[0][1]), 0.1), PIER_DECK), segs = [];
    let run = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      segs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, run });
      run += len;
    }
    if (segs.length) runs.push({ segs, w: Math.max(pier.width || 2.5, 1.5) / 2, g0, ramp: Math.min(Math.max((PIER_DECK - g0) / PIER_RAMP, 0.4), run * 0.5), length: run });
  }
  return runs;
}

/**
 * For walking on the piers: returns at(x, z) -> { height, ramp } where a deck (or the gangway up to it) lies
 * over that point, else null; at.spot(near, along) -> { x, z, yaw } is the point `along` metres out along the
 * pier whose landward end is nearest `near`, facing out to sea (yaw in degrees).
 */
export function pierWalk(piers, ground) {
  const runs = pierRuns(piers, ground);
  const at = (x, z) => {
    for (const r of runs) for (const s of r.segs) {
      const px = x - s.ax, pz = z - s.az, along = px * s.dx + pz * s.dz;
      if (along < -0.3 || along > s.len + 0.3 || Math.abs(px * s.dz - pz * s.dx) > r.w) continue;
      const d = Math.max(s.run + along, 0);
      return { height: d < r.ramp ? r.g0 + (PIER_DECK - r.g0) * d / r.ramp : PIER_DECK, ramp: d < r.ramp };
    }
    return null;
  };
  at.spot = (near, along) => {
    const r = runs.map(q => [Math.hypot(q.segs[0].ax - near[0], q.segs[0].az - near[1]), q]).sort((a, b) => a[0] - b[0])[0]?.[1];
    if (!r) return null;
    const d = Math.min(Math.max(along, 0), r.length - 0.5), s = r.segs.find(q => d <= q.run + q.len) || r.segs[r.segs.length - 1];
    return { x: s.ax + s.dx * (d - s.run), z: s.az + s.dz * (d - s.run), yaw: Math.atan2(s.dx, -s.dz) * 180 / Math.PI };
  };
  return at;
}

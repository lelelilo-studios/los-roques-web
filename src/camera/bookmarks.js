// Camera shots for the places you can fly to. A shot is an orbit state: the point looked at (x east, z south,
// metres; the place itself unless given), distance, heading (yaw, degrees clockwise from north) and elevation
// of the eye above that point's horizon (pitch).
const SHOTS = {
  overview: { dist: 47000, yaw: 0, pitch: 62 },
  'gran-roque-village': { dist: 950, yaw: -28, pitch: 13 },
  // The postcard: from the old Dutch lighthouse's hill down over the village, the airstrip and the cays beyond.
  'faro-holandes': { x: 9020, z: -10130, dist: 520, yaw: 172, pitch: 8 },
  'francisqui-la-piscina': { dist: 1100, yaw: -35, pitch: 19 },
  'madrisqui-cayo-pirata': { dist: 1050, yaw: 38, pitch: 17 },
  crasqui: { dist: 800, yaw: 75, pitch: 12 },
  noronqui: { dist: 1300, yaw: 15, pitch: 27 },
  'cayo-de-agua-isthmus': { dist: 430, yaw: -65, pitch: 13 },
  'cayo-de-agua-lighthouse': { dist: 260, yaw: 150, pitch: 10 },
  'dos-mosquises': { dist: 950, yaw: 20, pitch: 22 },
  'boca-del-medio': { dist: 1900, yaw: 80, pitch: 17 },
  'boca-de-cote': { dist: 2300, yaw: 170, pitch: 24 },
  'cayo-grande-mangroves': { dist: 1700, yaw: 60, pitch: 21 },
};
const DEFAULT = { dist: 1700, yaw: 25, pitch: 24 };

export const OVERVIEW = { id: 'overview', name: 'Whole archipelago', pos: [0, 0] };

export function shotFor(place) {
  return { x: place.pos[0], z: place.pos[1], ...DEFAULT, ...(SHOTS[place.id] || {}), ...(place.shot || {}) };
}

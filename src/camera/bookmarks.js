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

// Where you are put down in first person at each place: a point near `near` (default: the place), `shore` metres
// from the waterline (negative = up the beach) and facing `face` degrees off the direction of the sea.
const WALKS = {
  'gran-roque-village': { near: [8990, -10060], shore: -4, face: 150 },
  'faro-holandes': { near: [8963.7, -10636.8], shore: -260, face: 200 },
  'francisqui-la-piscina': { shore: -7, face: 20 },
  'madrisqui-cayo-pirata': { shore: -7, face: -30 },
  crasqui: { shore: -7, face: 25 },
  noronqui: { shore: -7, face: 0 },
  'cayo-de-agua-isthmus': { shore: -5, face: 70 },
  'cayo-de-agua-lighthouse': { shore: -6, face: 160 },
  'dos-mosquises': { shore: -7, face: 10 },
  'boca-del-medio': { shore: 30, face: 90 },
  'boca-de-cote': { shore: 20, face: 0 },
  'cayo-grande-mangroves': { near: [14585, 7691], shore: 5, face: 180 },      // knee deep, looking into the mangroves
};

export function walkSpotFor(place) {
  return { near: place.pos, shore: -7, face: 0, ...(WALKS[place.id] || {}) };
}

export const OVERVIEW = { id: 'overview', name: 'Whole archipelago', pos: [0, 0] };

export function shotFor(place) {
  return { x: place.pos[0], z: place.pos[1], ...DEFAULT, ...(SHOTS[place.id] || {}), ...(place.shot || {}) };
}

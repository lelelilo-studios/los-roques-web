// The animals of Los Roques that the simulation shows: each one on a record of it inside the archipelago.
//
// `records`: how many occurrence records GBIF holds of the species within latitude 11.70 to 12.00 N and longitude
// 66.98 to 66.55 W (asked on 2026-10-09 through api.gbif.org; most are the Museo Marino de Margarita's
// collection of the archipelago's fishes, the survey of its seagrass fishes, eBird and iNaturalist), or the
// source named in `by` where GBIF has none. An animal without a record is not here: see DROPPED.
//
// `length`: a usual adult, in metres (birds: bill to tail, with `span` their wings; the ray: its disc's width;
// the star and the urchin: across). These are the standard references' figures as I remember them (FishBase's
// "common length" for the fishes), not fetched again: the one thing here that is not checked against a source.
//
// `lives`: where it is put. reef: over coral and rubble; grass: over seagrass; sand: over bare sand in the
// lagoon; flats: in knee-deep water over sand; mangrove: among the roots and in the lagoons behind them;
// open: in the blue outside; shore: on the beach; air: over the sea; cay: on the islands.
export const FAUNA = [
  // ---- reef fishes
  { id: 'stoplight-parrotfish', name: 'Stoplight parrotfish', latin: 'Sparisoma viride', length: 0.38, lives: ['reef'], records: 4, group: 'reef' },
  { id: 'queen-parrotfish', name: 'Queen parrotfish', latin: 'Scarus vetula', length: 0.32, lives: ['reef'], records: 2, group: 'reef' },
  { id: 'striped-parrotfish', name: 'Striped parrotfish', latin: 'Scarus iseri', length: 0.25, lives: ['reef', 'grass'], records: 2, group: 'reef' },
  { id: 'blue-tang', name: 'Blue tang', latin: 'Acanthurus coeruleus', length: 0.25, lives: ['reef'], records: 7, group: 'reef' },
  { id: 'sergeant-major', name: 'Sergeant major', latin: 'Abudefduf saxatilis', length: 0.15, lives: ['reef'], records: 19, group: 'reef' },
  { id: 'french-grunt', name: 'French grunt', latin: 'Haemulon flavolineatum', length: 0.17, lives: ['reef', 'grass'], records: 28, group: 'reef' },
  { id: 'yellowtail-snapper', name: 'Yellowtail snapper', latin: 'Ocyurus chrysurus', length: 0.4, lives: ['reef', 'open'], records: 4, group: 'reef' },
  { id: 'queen-angelfish', name: 'Queen angelfish', latin: 'Holacanthus ciliaris', length: 0.3, lives: ['reef'], records: 2, group: 'reef' },
  { id: 'foureye-butterflyfish', name: 'Foureye butterflyfish', latin: 'Chaetodon capistratus', length: 0.075, lives: ['reef'], records: 5, group: 'reef' },
  { id: 'bluehead-wrasse', name: 'Bluehead wrasse', latin: 'Thalassoma bifasciatum', length: 0.11, lives: ['reef'], records: 18, group: 'reef' },
  { id: 'trumpetfish', name: 'Trumpetfish', latin: 'Aulostomus maculatus', length: 0.6, lives: ['reef'], records: 8, group: 'reef' },
  { id: 'squirrelfish', name: 'Squirrelfish', latin: 'Holocentrus adscensionis', length: 0.25, lives: ['reef'], records: 10, group: 'reef' },
  { id: 'spotted-trunkfish', name: 'Spotted trunkfish', latin: 'Lactophrys bicaudalis', length: 0.25, lives: ['reef', 'grass'], records: 2, group: 'reef' },
  { id: 'porcupinefish', name: 'Porcupinefish', latin: 'Diodon hystrix', length: 0.4, lives: ['reef'], records: 1, group: 'reef' },
  { id: 'spotted-moray', name: 'Spotted moray', latin: 'Gymnothorax moringa', length: 0.6, lives: ['reef'], records: 19, group: 'reef' },
  { id: 'lionfish', name: 'Red lionfish', latin: 'Pterois volitans', length: 0.3, lives: ['reef'], records: 34, group: 'reef', note: 'invasive; first seen here in 2009: kept rare' },
  // ---- over sand, grass and the flats
  { id: 'peacock-flounder', name: 'Peacock flounder', latin: 'Bothus lunatus', length: 0.35, lives: ['sand'], records: 4, group: 'sand' },
  { id: 'southern-stingray', name: 'Southern stingray', latin: 'Hypanus americanus', length: 0.9, lives: ['sand', 'flats'], records: 4, group: 'sand', note: 'length: the width of its disc' },
  { id: 'bonefish', name: 'Bonefish', latin: 'Albula vulpes', length: 0.55, lives: ['flats'], records: 4, group: 'flats' },
  { id: 'permit', name: 'Permit', latin: 'Trachinotus falcatus', length: 0.75, lives: ['flats', 'sand'], records: 5, group: 'flats' },
  { id: 'white-mullet', name: 'White mullet', latin: 'Mugil curema', length: 0.3, lives: ['flats', 'mangrove'], records: 14, group: 'flats' },
  { id: 'silverside', name: 'Hardhead silverside', latin: 'Atherinomorus stipes', length: 0.075, lives: ['flats', 'mangrove', 'grass'], records: 14, group: 'flats' },
  { id: 'houndfish', name: 'Houndfish', latin: 'Tylosurus crocodilus', length: 0.9, lives: ['flats', 'open'], records: 1, group: 'flats', note: 'the needlefish of the list' },
  // ---- the hunters, and the large animals
  { id: 'great-barracuda', name: 'Great barracuda', latin: 'Sphyraena barracuda', length: 1.1, lives: ['reef', 'grass', 'open'], records: 5, group: 'large' },
  { id: 'horse-eye-jack', name: 'Horse-eye jack', latin: 'Caranx latus', length: 0.55, lives: ['reef', 'open'], records: 3, group: 'large' },
  { id: 'tarpon', name: 'Tarpon', latin: 'Megalops atlanticus', length: 0.7, lives: ['mangrove'], records: 0, by: 'the fly-fishing lodges of Gran Roque, which fish for it in the mangrove lagoons (no record in GBIF)', group: 'large' },
  { id: 'nurse-shark', name: 'Nurse shark', latin: 'Ginglymostoma cirratum', length: 2.3, lives: ['reef'], records: 3, group: 'large' },
  { id: 'lemon-shark-pup', name: 'Lemon shark (young)', latin: 'Negaprion brevirostris', length: 0.85, lives: ['mangrove', 'flats'], records: 3, group: 'large', note: 'born 55 cm long; the Sebastopol lagoon is a nursery (Tavares 2016)' },
  { id: 'green-turtle', name: 'Green turtle', latin: 'Chelonia mydas', length: 1.0, lives: ['grass'], records: 324, group: 'large' },
  { id: 'hawksbill', name: 'Hawksbill turtle', latin: 'Eretmochelys imbricata', length: 0.8, lives: ['reef'], records: 78, group: 'large' },
  { id: 'reef-octopus', name: 'Caribbean reef octopus', latin: 'Octopus briareus', length: 0.6, lives: ['reef'], records: 1, group: 'large', note: 'length: arm tip to arm tip' },
  // ---- on the bottom
  { id: 'queen-conch', name: 'Queen conch', latin: 'Aliger gigas', length: 0.25, lives: ['grass', 'sand'], records: 5, group: 'bottom' },
  { id: 'spiny-lobster', name: 'Caribbean spiny lobster', latin: 'Panulirus argus', length: 0.3, lives: ['reef'], records: 3, group: 'bottom' },
  { id: 'cushion-star', name: 'Cushion sea star', latin: 'Oreaster reticulatus', length: 0.25, lives: ['grass', 'sand'], records: 1, group: 'bottom' },
  { id: 'long-spined-urchin', name: 'Long-spined urchin', latin: 'Diadema antillarum', length: 0.3, lives: ['reef'], records: 4, group: 'bottom' },
  { id: 'sea-egg', name: 'West Indian sea egg', latin: 'Tripneustes ventricosus', length: 0.12, lives: ['grass'], records: 2, group: 'bottom' },
  // ---- birds
  { id: 'brown-pelican', name: 'Brown pelican', latin: 'Pelecanus occidentalis', length: 1.15, span: 2.0, lives: ['air', 'shore'], records: 270, group: 'bird' },
  { id: 'brown-booby', name: 'Brown booby', latin: 'Sula leucogaster', length: 0.74, span: 1.4, lives: ['air'], records: 199, group: 'bird' },
  { id: 'red-footed-booby', name: 'Red-footed booby', latin: 'Sula sula', length: 0.7, span: 1.0, lives: ['air'], records: 48, group: 'bird' },
  { id: 'frigatebird', name: 'Magnificent frigatebird', latin: 'Fregata magnificens', length: 1.0, span: 2.3, lives: ['air'], records: 171, group: 'bird' },
  { id: 'laughing-gull', name: 'Laughing gull', latin: 'Leucophaeus atricilla', length: 0.4, span: 1.0, lives: ['air', 'shore'], records: 201, group: 'bird' },
  { id: 'royal-tern', name: 'Royal tern', latin: 'Thalasseus maximus', length: 0.48, span: 1.05, lives: ['air', 'shore'], records: 123, group: 'bird' },
  { id: 'brown-noddy', name: 'Brown noddy', latin: 'Anous stolidus', length: 0.4, span: 0.8, lives: ['air'], records: 87, group: 'bird' },
  { id: 'black-noddy', name: 'Black noddy', latin: 'Anous minutus', length: 0.35, span: 0.7, lives: ['air'], records: 11, group: 'bird', note: 'its largest Caribbean colony is here (Bosque 2015)' },
  // ---- on the shore and the cays
  { id: 'ghost-crab', name: 'Atlantic ghost crab', latin: 'Ocypode quadrata', length: 0.05, lives: ['shore'], records: 2, group: 'shore', note: 'length: across its shell' },
  { id: 'hermit-crab', name: 'Caribbean hermit crab', latin: 'Coenobita clypeatus', length: 0.07, lives: ['shore', 'cay'], records: 4, group: 'shore' },
  { id: 'whiptail', name: 'Los Roques whiptail', latin: 'Cnemidophorus nigricolor', length: 0.28, lives: ['cay'], records: 72, group: 'shore', note: 'found only on these islands and their neighbours; the males all black' },
];

/** What was on the list and is not shown, and why. */
export const DROPPED = [
  { name: 'Bar jack', latin: 'Caranx ruber', why: 'no record inside the archipelago; the horse-eye jack, which has three, is the jack shown' },
  { name: 'Green moray', latin: 'Gymnothorax funebris', why: 'no record in GBIF (one photograph of 1976); the spotted moray, with nineteen, is the moray shown' },
  { name: 'Spotted eagle ray', latin: 'Aetobatus narinari', why: 'no record inside the archipelago' },
  { name: 'Redfin needlefish', latin: 'Strongylura notata', why: 'no record; the houndfish, with one, is the needlefish shown' },
  { name: 'Dolphins', latin: 'Tursiops truncatus, Stenella frontalis', why: 'no record inside the archipelago: only for the mainland coast' },
  { name: 'Upside-down jellyfish', latin: 'Cassiopea xamachana', why: 'no record' },
  { name: 'Mangrove oyster', latin: 'Crassostrea rhizophorae', why: 'no record' },
];

export const byId = id => FAUNA.find(f => f.id === id) || null;

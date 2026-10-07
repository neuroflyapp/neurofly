// habitat-content.js — everything the Habitat game says and offers, as data.
// Texts are bilingual records ({ en, de }); a text may name the fly with
// {name}, which keeps them free of pronouns for female and male flies alike.
// Game rules (rewards, durations, prices) live here too, so they can be read
// and tuned in one place. No DOM, no simulation access.

import { LITERATURE } from './experiments.js';

const REF = {
  ...LITERATURE,
  klapoetke2017: { cite: 'Klapoetke et al. (2017) Nature 551:237', doi: 'https://doi.org/10.1038/nature24626' },
  brand1993: { cite: 'Brand & Perrimon (1993) Development 118:401', doi: 'https://doi.org/10.1242/dev.118.2.401' },
  baines2001: { cite: 'Baines et al. (2001) J Neurosci 21:1523', doi: 'https://doi.org/10.1523/JNEUROSCI.21-05-01523.2001' },
  klapoetke2014: { cite: 'Klapoetke et al. (2014) Nat Methods 11:338', doi: 'https://doi.org/10.1038/nmeth.2836' },
  gallio2011: { cite: 'Gallio et al. (2011) Cell 144:614', doi: 'https://doi.org/10.1016/j.cell.2011.01.028' },
  ni2013: { cite: 'Ni et al. (2013) Nature 500:580', doi: 'https://doi.org/10.1038/nature12390' },
  namiki2018: { cite: 'Namiki et al. (2018) eLife 7:e34272', doi: 'https://doi.org/10.7554/eLife.34272' },
};
export { REF as HABITAT_REFERENCES };

export const RARITY = Object.freeze({
  common: { xp: 20, leaves: 3 },
  uncommon: { xp: 40, leaves: 6 },
  rare: { xp: 80, leaves: 12 },
});

// ---- neuron cards ---------------------------------------------------------------------------
// `pops` are the simulation's populations (closed-loop.js populations()) the
// card stands for; `highlight` is the brain view's group for "show in the brain" (view/brain.js
// GROUPS; null where the view has no group of its own); `inputs`
// unlocks the card when that model input drives the cells (snapshot.inputs).
export const NEURONS = Object.freeze([
  { id: 'gf', pops: ['gf'], label: 'DNp01', highlight: 'gf', ref: 'vonReyn2014',
    name: { en: 'Giant fiber', de: 'Riesenfaser' },
    fact: { en: 'Two of the largest neurons in the fly brain. One spike commands a fast escape takeoff within a few milliseconds.',
      de: 'Zwei der grössten Neuronen im Fliegengehirn. Ein einziger Spike löst in wenigen Millisekunden einen Fluchtstart aus.' } },
  { id: 'lc4', pops: ['lc4'], label: 'LC4', highlight: 'loom', ref: 'vonReyn2017', modality: 'vision',
    name: { en: 'Looming detector LC4', de: 'Annäherungsdetektor LC4' },
    fact: { en: 'Visual projection neurons that respond when a dark object grows fast in the eye, and pass it on to the giant fiber.',
      de: 'Visuelle Projektionsneuronen. Sie antworten, wenn ein dunkles Objekt im Auge schnell grösser wird, und melden es an die Riesenfaser.' } },
  { id: 'lplc2', pops: ['lplc2'], label: 'LPLC2', highlight: 'loom', ref: 'klapoetke2017', modality: 'vision',
    name: { en: 'Looming detector LPLC2', de: 'Annäherungsdetektor LPLC2' },
    fact: { en: 'Respond only to edges moving outward in all directions at once: the signature of something on a collision course.',
      de: 'Antworten nur auf Kanten, die sich gleichzeitig in alle Richtungen ausdehnen: das Kennzeichen von etwas, das genau auf die Fliege zukommt.' } },
  { id: 'dna', pops: ['dnaL', 'dnaR'], label: 'DNa01 / DNa02', highlight: 'dna', ref: 'rayshubskiy2020',
    name: { en: 'Steering neurons', de: 'Steuerneuronen' },
    fact: { en: 'Descending neurons whose left-right difference predicts and drives turns while walking.',
      de: 'Absteigende Neuronen: Der Unterschied zwischen links und rechts sagt Kurven beim Laufen voraus und löst sie aus.' } },
  { id: 'mdn', pops: ['mdn'], label: 'MDN', highlight: 'mdn', ref: 'bidaye2014',
    name: { en: 'Moonwalker neurons', de: 'Moonwalker-Neuronen' },
    fact: { en: 'Activating these four descending neurons makes a fly walk backward, like a moonwalk.',
      de: 'Werden diese vier absteigenden Neuronen aktiviert, läuft eine Fliege rückwärts, wie beim Moonwalk.' } },
  { id: 'fwd', pops: ['fwd'], label: 'DNp09', highlight: 'fwd', ref: 'bidaye2020',
    name: { en: 'Forward walking neurons', de: 'Vorwärtslauf-Neuronen' },
    fact: { en: 'Activating DNp09 starts forward walking, one of two brain pathways that begin a walk.',
      de: 'DNp09 startet das Vorwärtslaufen: einer von zwei Wegen im Gehirn, die einen Lauf beginnen.' } },
  { id: 'groom', pops: ['groom'], label: 'DNg11', highlight: 'groom', ref: 'guo2022',
    name: { en: 'Leg-rubbing neurons', de: 'Beinreibe-Neuronen' },
    fact: { en: 'Descending neurons for rubbing the front legs together, part of the fly\'s cleaning sequence.',
      de: 'Absteigende Neuronen für das Aneinanderreiben der Vorderbeine, ein Teil der Putzfolge der Fliege.' } },
  { id: 'dng12', pops: ['dng12'], label: 'DNg12', highlight: 'dng12', ref: 'guo2022',
    name: { en: 'Head-grooming neurons', de: 'Kopfputz-Neuronen' },
    fact: { en: 'Descending neurons that start head and antenna grooming: the front legs sweep over the head.',
      de: 'Absteigende Neuronen, die das Putzen von Kopf und Antennen starten: Die Vorderbeine streichen über den Kopf.' } },
  { id: 'escw', pops: ['escw'], label: 'DNp02 / DNp04 / DNp11', highlight: 'escw', ref: 'namiki2018',
    name: { en: 'Escape-wing neurons', de: 'Flucht-Flügel-Neuronen' },
    fact: { en: 'Descending neurons active when a threat approaches; in this model they raise the wings and set the wingbeat effort.',
      de: 'Absteigende Neuronen, die bei Bedrohung aktiv werden; im Modell heben sie die Flügel und bestimmen die Schlagkraft.' } },
  { id: 'joF', pops: ['joF'], label: 'JO-F', highlight: 'joF', ref: 'hampel2020', modality: 'mechano', inputs: ['dust'],
    name: { en: 'Antenna dust sensors', de: 'Staubsensoren der Antenne' },
    fact: { en: 'Johnston\'s organ cells that feel the antenna being deflected; their pathway leads to antennal grooming.',
      de: 'Zellen des Johnston-Organs, die spüren, wenn die Antenne ausgelenkt wird; ihr Weg führt zum Putzen der Antennen.' } },
  { id: 'joAB', pops: ['joA'], label: 'JO-A / JO-B', highlight: null, ref: 'kamikouchi2009', modality: 'mechano', inputs: ['sound'],
    name: { en: 'Hearing neurons', de: 'Hörneuronen' },
    fact: { en: 'The antenna is the fly\'s ear: these Johnston\'s organ cells respond to near-field sound such as courtship song.',
      de: 'Die Antenne ist das Ohr der Fliege: Diese Zellen des Johnston-Organs antworten auf Nahfeldschall, etwa Balzgesang.' } },
  { id: 'joCDE', pops: ['joW'], label: 'JO-C / JO-D / JO-E', highlight: null, ref: 'yorozu2009', modality: 'mechano', inputs: ['wind', 'antennaContact'],
    name: { en: 'Wind and gravity neurons', de: 'Wind- und Schwerkraftneuronen' },
    fact: { en: 'Johnston\'s organ cells that report steady deflection of the antenna: wind, gravity and touch.',
      de: 'Zellen des Johnston-Organs, die eine anhaltende Auslenkung der Antenne melden: Wind, Schwerkraft und Berührung.' } },
  { id: 'sugarGRN', pops: ['sugar'], label: 'Gr64f GRNs', highlight: 'sugar', ref: 'shiu2024', modality: 'taste', inputs: ['sugar'],
    name: { en: 'Sugar taste neurons', de: 'Zucker-Geschmacksneuronen' },
    fact: { en: 'Taste neurons on the proboscis tip that detect sugar and water; activating them makes a fly extend the proboscis.',
      de: 'Geschmacksneuronen an der Rüsselspitze, die Zucker und Wasser erkennen; aktiviert, strecken sie den Rüssel aus.' } },
  { id: 'bitterGRN', pops: ['bitter'], label: 'Gr66a GRNs', highlight: 'bitter', ref: 'shiu2024', modality: 'taste', inputs: ['bitter'],
    name: { en: 'Bitter taste neurons', de: 'Bitter-Geschmacksneuronen' },
    fact: { en: 'Taste neurons that detect bitter compounds and hold back feeding.',
      de: 'Geschmacksneuronen, die Bitterstoffe erkennen und das Fressen bremsen.' } },
  { id: 'perMN', pops: ['proboscisMN'], label: 'MN9 …', highlight: 'proboscis', ref: 'shiu2024',
    name: { en: 'Proboscis motor neurons', de: 'Rüssel-Motorneuronen' },
    fact: { en: 'Motor neurons that extend the proboscis. A whole-connectome model predicted which brain cells drive them.',
      de: 'Motorneuronen, die den Rüssel ausstrecken. Ein Modell des ganzen Konnektoms sagte voraus, welche Hirnzellen sie antreiben.' } },
  { id: 'hotCell', pops: ['hot'], label: 'HC · Gr28b.d', highlight: 'hot', ref: 'ni2013', modality: 'thermo', inputs: ['hot'],
    name: { en: 'Hot cells', de: 'Wärmezellen' },
    fact: { en: 'Neurons in the antenna\'s arista that fire when it warms up, and help a fly turn away from heat.',
      de: 'Neuronen in der Arista der Antenne, die bei Erwärmung feuern und der Fliege helfen, sich von Hitze abzuwenden.' } },
  { id: 'coldCell', pops: ['cold'], label: 'CC · Brv1', highlight: 'cold', ref: 'gallio2011', modality: 'thermo', inputs: ['cold'],
    name: { en: 'Cold cells', de: 'Kältezellen' },
    fact: { en: 'Neurons in the arista that fire when it cools. Hot and cold cells form separate lines into the brain.',
      de: 'Neuronen in der Arista, die bei Abkühlung feuern. Wärme- und Kältezellen bilden getrennte Leitungen ins Gehirn.' } },
  { id: 'ascend', pops: ['ascend'], label: 'AN', highlight: null, ref: 'namiki2018',
    name: { en: 'Body feedback', de: 'Rückmeldung vom Körper' },
    fact: { en: 'Ascending neurons carry news from the nerve cord to the brain. In the model they rise when the legs really walk.',
      de: 'Aufsteigende Neuronen tragen Nachrichten vom Nervenstrang ins Gehirn. Im Modell steigen sie, wenn die Beine wirklich laufen.' } },
]);

// ---- behaviours (the field journal) --------------------------------------------------------
// `event` behaviours come from the simulation's explained events (causal.js);
// `state` ones from changes of her behavioural state.
export const BEHAVIOURS = Object.freeze([
  { id: 'walk', state: 'walking', rarity: 'common', icon: 'live', neurons: ['fwd', 'ascend'],
    title: { en: 'Walking', de: 'Laufen' },
    text: { en: '{name} walks. DNp09 starts the walk; six legs step through the real nerve cord.',
      de: '{name} läuft. DNp09 startet den Lauf; sechs Beine treten über den echten Nervenstrang.' } },
  { id: 'turnLeft', event: 'turnLeft', rarity: 'common', icon: 'repeat', neurons: ['dna'],
    title: { en: 'Left turn', de: 'Linkskurve' },
    text: { en: 'More steering activity on the left side turned {name} to the left.',
      de: 'Mehr Steueraktivität auf der linken Seite lenkte {name} nach links.' } },
  { id: 'turnRight', event: 'turnRight', rarity: 'common', icon: 'repeat', neurons: ['dna'],
    title: { en: 'Right turn', de: 'Rechtskurve' },
    text: { en: 'More steering activity on the right side turned {name} to the right.',
      de: 'Mehr Steueraktivität auf der rechten Seite lenkte {name} nach rechts.' } },
  { id: 'legGrooming', event: 'legGrooming', rarity: 'common', icon: 'groom', neurons: ['groom'],
    title: { en: 'Leg rubbing', de: 'Beine reiben' },
    text: { en: '{name} rubs the front legs together: DNg11 crossed its threshold.',
      de: '{name} reibt die Vorderbeine aneinander: DNg11 hat seine Schwelle überschritten.' } },
  { id: 'headGrooming', event: 'headGrooming', rarity: 'uncommon', icon: 'groom', neurons: ['dng12', 'joF'],
    title: { en: 'Head grooming', de: 'Kopf putzen' },
    text: { en: '{name} sweeps the head clean. DNg12 started the sequence.',
      de: '{name} streicht sich den Kopf sauber. DNg12 hat die Putzfolge gestartet.' } },
  { id: 'proboscis', event: 'proboscis', rarity: 'uncommon', icon: 'drop', neurons: ['perMN', 'sugarGRN'],
    title: { en: 'Proboscis out', de: 'Rüssel ausgestreckt' },
    text: { en: 'The proboscis motor neurons fired and {name} extended the proboscis.',
      de: 'Die Rüssel-Motorneuronen feuerten, und {name} streckte den Rüssel aus.' } },
  { id: 'feeding', event: 'feeding', rarity: 'common', icon: 'drop', neurons: ['sugarGRN', 'perMN'],
    title: { en: 'Feeding', de: 'Fressen' },
    text: { en: '{name} drinks. Sugar neurons on the proboscis keep the motor neurons going.',
      de: '{name} trinkt. Zuckerneuronen an der Rüsselspitze halten die Motorneuronen in Gang.' } },
  { id: 'takeoff', event: 'takeoff', rarity: 'common', icon: 'bolt', neurons: ['gf', 'lc4', 'lplc2', 'escw'],
    title: { en: 'Escape takeoff', de: 'Fluchtstart' },
    text: { en: 'Something loomed, the looming detectors fired, and one giant-fiber spike launched {name}.',
      de: 'Etwas kam näher, die Annäherungsdetektoren feuerten, und ein Spike der Riesenfaser liess {name} abheben.' } },
  { id: 'dart', event: 'dart', rarity: 'uncommon', icon: 'speed', neurons: ['lc4', 'lplc2'],
    title: { en: 'Dodge on foot', de: 'Ausweichen zu Fuss' },
    text: { en: 'The looming detectors fired, but without a giant-fiber spike: {name} dodged on foot instead of flying off.',
      de: 'Die Annäherungsdetektoren feuerten, doch ohne Spike der Riesenfaser: {name} wich zu Fuss aus, statt abzufliegen.' } },
  { id: 'landing', state: 'landed', rarity: 'common', icon: 'world', neurons: [],
    title: { en: 'Landing', de: 'Landung' },
    text: { en: '{name} lands again, braking with a flare just before touchdown.',
      de: '{name} landet wieder und bremst kurz vor dem Aufsetzen ab.' } },
  { id: 'spontaneousFlight', event: 'spontaneousFlight', rarity: 'uncommon', icon: 'wind', neurons: [],
    title: { en: 'Flight of its own accord', de: 'Abflug aus eigenem Antrieb' },
    text: { en: '{name} took off with nothing approaching. No single neuron decides this: in the model, the brain\'s overall activity opens the gate.',
      de: '{name} flog ab, ohne dass sich etwas näherte. Kein einzelnes Neuron entscheidet das: Im Modell öffnet die Gesamtaktivität des Gehirns das Tor.' } },
  { id: 'backward', event: 'backward', rarity: 'rare', icon: 'repeat', neurons: ['mdn'],
    title: { en: 'Moonwalk', de: 'Moonwalk' },
    text: { en: 'An MDN burst: {name} walks backward.',
      de: 'Ein Feuerstoss der MDN-Neuronen: {name} läuft rückwärts.' } },
  { id: 'sleep', state: 'sleeping', rarity: 'rare', icon: 'pause', neurons: [],
    title: { en: 'Sleep', de: 'Schlaf' },
    text: { en: '{name} sleeps. Flies sleep at night; in the model, a quiet computer at night lets {name} rest.',
      de: '{name} schläft. Fliegen schlafen nachts; im Modell darf sie ruhen, wenn der Computer nachts still ist.' } },
]);

// Trigger channels of explained events (causal.js) -> the neuron cards they name.
export const TRIGGER_CARDS = Object.freeze({
  loomL: ['lc4', 'lplc2'], loomR: ['lc4', 'lplc2'], sound: ['joAB'], wind: ['joCDE'], antennaContact: ['joCDE'],
  puff: ['joAB', 'joCDE'], sugar: ['sugarGRN'], bitter: ['bitterGRN'], dust: ['joF'], hot: ['hotCell'], cold: ['coldCell'],
});

// ---- stock collection (fly genetics) -------------------------------------------------------
// GAL4 drivers express GAL4 in one population; UAS effectors do something
// wherever GAL4 is (Brand & Perrimon 1993). A cross of the two gives F1 flies
// whose `population` the simulation silences or activates (closed-loop.js
// virtual genetics). Names are stylised: real lines are often split-GAL4.
export const STOCKS = Object.freeze([
  { id: 'gf', kind: 'driver', population: 'gf', label: 'DNp01-GAL4', card: 'gf', cost: 0, level: 1 },
  { id: 'dng12', kind: 'driver', population: 'dng12', label: 'DNg12-GAL4', card: 'dng12', cost: 0, level: 1 },
  { id: 'lc4', kind: 'driver', population: 'lc4', label: 'LC4-GAL4', card: 'lc4', cost: 40, level: 3 },
  { id: 'groom', kind: 'driver', population: 'groom', label: 'DNg11-GAL4', card: 'groom', cost: 40, level: 3 },
  { id: 'sugar', kind: 'driver', population: 'sugar', label: 'Gr64f-GAL4', card: 'sugarGRN', cost: 40, level: 3 },
  { id: 'bitter', kind: 'driver', population: 'bitter', label: 'Gr66a-GAL4', card: 'bitterGRN', cost: 40, level: 4 },
  { id: 'mdn', kind: 'driver', population: 'mdn', label: 'MDN-GAL4', card: 'mdn', cost: 50, level: 4 },
  { id: 'fwd', kind: 'driver', population: 'fwd', label: 'DNp09-GAL4', card: 'fwd', cost: 50, level: 4 },
  { id: 'joF', kind: 'driver', population: 'joF', label: 'JO-F-GAL4', card: 'joF', cost: 50, level: 5 },
  { id: 'perMN', kind: 'driver', population: 'proboscisMN', label: 'MN9-GAL4', card: 'perMN', cost: 60, level: 5 },
  { id: 'escw', kind: 'driver', population: 'escw', label: 'DNp02/04/11-GAL4', card: 'escw', cost: 60, level: 6 },
  { id: 'hot', kind: 'driver', population: 'hot', label: 'Gr28b.d-GAL4', card: 'hotCell', cost: 60, level: 6 },
  { id: 'kir', kind: 'effector', mode: 'silence', label: 'UAS-Kir2.1', cost: 0, level: 1, ref: 'baines2001',
    name: { en: 'Silencer', de: 'Stummschalter' },
    fact: { en: 'A potassium channel that keeps neurons from firing: the population falls silent.',
      de: 'Ein Kaliumkanal, der Neuronen am Feuern hindert: Die Population verstummt.' } },
  { id: 'chrimson', kind: 'effector', mode: 'activate', label: 'UAS-CsChrimson', cost: 0, level: 1, ref: 'klapoetke2014',
    name: { en: 'Red-light switch', de: 'Rotlicht-Schalter' },
    fact: { en: 'A light-gated channel: under red light the population fires. Flies barely see red, so the light itself hardly disturbs them.',
      de: 'Ein lichtgesteuerter Kanal: Unter Rotlicht feuert die Population. Fliegen sehen Rot kaum, das Licht selbst stört sie also wenig.' } },
  { id: 'trpa1', kind: 'effector', mode: 'heat', label: 'UAS-TrpA1', cost: 50, level: 5, ref: 'hamada2008',
    name: { en: 'Heat switch', de: 'Wärmeschalter' },
    fact: { en: 'A warmth-gated channel: above about 29 °C the population fires. The warmth also reaches the fly\'s own hot cells, so real experiments compare with flies without TrpA1.',
      de: 'Ein wärmegesteuerter Kanal: Über etwa 29 °C feuert die Population. Die Wärme erreicht auch die eigenen Wärmezellen der Fliege, darum vergleichen echte Versuche mit Fliegen ohne TrpA1.' } },
]);
export const OPTO_STRENGTH = 0.06;
// UAS-TrpA1 opens above about 29 °C and closes again below 27 °C (game rule
// for the switch points; the channel's real activation lies in this range).
export const HEAT_ON_C = 29, HEAT_OFF_C = 27;

// ---- vials ----------------------------------------------------------------------------------
// Game time: a real cross takes about ten days at 25 °C. The first vial of
// each kind is quick, so the first session sees its own F1.
export const VIAL = Object.freeze({
  maxVials: 3, maxFlies: 12,
  crossCost: 10, wildCost: 5,
  crossMs: 15 * 60_000, wildMs: 10 * 60_000, firstMs: 2 * 60_000,
});

export const FLY_NAMES = Object.freeze(['Nova', 'Pip', 'Mira', 'Juno', 'Kiwi', 'Luma', 'Fizz', 'Tiko', 'Bea', 'Zuri',
  'Pixel', 'Momo', 'Lotti', 'Ari', 'Sola', 'Wren', 'Nimbus', 'Cleo', 'Rio', 'Tess', 'Indi', 'Yuki', 'Olli', 'Fenna']);

// ---- the garden: the world's own objects, placed by the player -------------------------------
// They become part of her world (closed-loop.js world.add): her eye sees them,
// solid ones block her way, flowers and berries carry a scent (measured, not
// routed to any neuron). One piece costs leaves once; removed pieces go back
// to storage and can be placed again for free.
export const GARDEN_ITEMS = Object.freeze([
  { id: 'fern', kind: 'fern', radius: 15, cost: 0, level: 1, name: { en: 'Fern', de: 'Farn' } },
  { id: 'flower', kind: 'flower', radius: 12, cost: 8, level: 1, name: { en: 'Flower', de: 'Blume' } },
  { id: 'pebble', kind: 'pebble', radius: 10, cost: 6, level: 1, name: { en: 'Pebble', de: 'Kiesel' } },
  { id: 'berry', kind: 'berry', radius: 11, cost: 12, level: 2, name: { en: 'Berries', de: 'Beeren' } },
  { id: 'mushroom', kind: 'mushroom', radius: 16, cost: 15, level: 2, name: { en: 'Mushroom', de: 'Pilz' } },
  { id: 'rock', kind: 'rock', radius: 20, cost: 15, level: 3, name: { en: 'Rock', de: 'Stein' } },
  { id: 'twig', kind: 'twig', radius: 17, cost: 10, level: 3, name: { en: 'Twig', de: 'Zweig' } },
  { id: 'branch', kind: 'branch', radius: 21, cost: 20, level: 4, name: { en: 'Fallen branch', de: 'Ast' } },
  { id: 'bush', kind: 'bush', radius: 22, cost: 25, level: 4, name: { en: 'Bush', de: 'Busch' } },
  { id: 'stump', kind: 'stump', radius: 23, cost: 30, level: 5, name: { en: 'Tree stump', de: 'Baumstumpf' } },
  { id: 'log', kind: 'log', radius: 28, cost: 35, level: 5, name: { en: 'Log', de: 'Holzstamm' } },
]);
// Never closer to the fly than closed-loop.js allows (WORLD_EDIT_*); a piece
// restored after a restart may stand nearer, but not on her.
export const GARDEN = Object.freeze({ maxPieces: 16, minFlyDistance: 140, restoreMinFlyDistance: 40 });

// ---- ranks ----------------------------------------------------------------------------------
// One-time rewards add up to about 2,200 XP; the last ranks take weeks of
// field notes and care, as a long-term goal.
export const RANKS = Object.freeze([
  { xp: 0, en: 'Egg', de: 'Ei' },
  { xp: 120, en: 'Larva L1', de: 'Larve L1' },
  { xp: 300, en: 'Larva L2', de: 'Larve L2' },
  { xp: 550, en: 'Larva L3', de: 'Larve L3' },
  { xp: 900, en: 'Pupa', de: 'Puppe' },
  { xp: 1350, en: 'Imago', de: 'Imago' },
  { xp: 1900, en: 'Field naturalist', de: 'Feldforschung' },
  { xp: 2600, en: 'Fly geneticist', de: 'Fliegengenetik' },
  { xp: 3500, en: 'Neuroethologist', de: 'Neuroethologie' },
  { xp: 4600, en: 'Connectome cartographer', de: 'Konnektom-Kartografie' },
]);

// ---- quests ---------------------------------------------------------------------------------
export const CHAPTERS = Object.freeze([
  { id: 'meet', title: { en: 'Meet your fly', de: 'Lerne deine Fliege kennen' } },
  { id: 'brain', title: { en: 'Understand a brain', de: 'Ein Gehirn verstehen' } },
  { id: 'genetics', title: { en: 'Fly genetics', de: 'Fliegengenetik' }, gift: ['gf', 'kir'] },
  { id: 'question', title: { en: 'The big question', de: 'Die grosse Frage' } },
]);

export const QUESTS = Object.freeze([
  { id: 'name', chapter: 'meet', kind: 'action', target: 'rename', xp: 30, leaves: 10,
    title: { en: 'A name', de: 'Ein Name' },
    task: { en: 'Give your fly a name: click the name on the fly card.', de: 'Gib deiner Fliege einen Namen: Klicke auf den Namen in der Fliegenkarte.' },
    why: { en: 'Every individual runs the same wiring with its own seed; names keep them apart.', de: 'Jedes Individuum hat dieselbe Verschaltung mit eigenem Seed; Namen halten sie auseinander.' } },
  { id: 'walk', chapter: 'meet', kind: 'discover', targets: ['walk'], xp: 30, leaves: 10,
    title: { en: 'First steps', de: 'Erste Schritte' },
    task: { en: 'Watch {name} walk.', de: 'Sieh {name} beim Laufen zu.' },
    why: { en: 'The brain decides to walk; the stepping happens in the nerve cord, through real motor neurons.', de: 'Das Gehirn entscheidet zu laufen; die Schritte entstehen im Nervenstrang, über echte Motorneuronen.' } },
  { id: 'sugar', chapter: 'meet', kind: 'discover', targets: ['feeding'], xp: 50, leaves: 15,
    title: { en: 'A sweet drop', de: 'Ein süsser Tropfen' },
    task: { en: 'Touch a sugar drop to the proboscis (Feed) and watch.', de: 'Halte {name} einen Zuckertropfen an den Rüssel (Füttern) und schau zu.' },
    why: { en: 'This is the proboscis extension test of real fly labs. Whether the proboscis comes out is decided by the taste circuit, not by the game.', de: 'Das ist der Rüsseltest echter Fliegenlabore. Ob der Rüssel herauskommt, entscheidet der Geschmackskreis, nicht das Spiel.' } },
  { id: 'dust', chapter: 'meet', kind: 'discover', targets: ['headGrooming'], xp: 50, leaves: 15,
    title: { en: 'Grooming time', de: 'Putzstunde' },
    task: { en: 'Dust the antennae (Dust) and watch what happens.', de: 'Bestäube die Antennen (Staub) und sieh zu, was passiert.' },
    why: { en: 'Dust deflects the antenna; Johnston\'s organ cells notice and their pathway reaches DNg12.', de: 'Staub lenkt die Antenne aus; Zellen des Johnston-Organs bemerken es, und ihr Weg erreicht DNg12.' } },
  { id: 'home', chapter: 'meet', kind: 'garden', xp: 30, leaves: 10,
    title: { en: 'A home', de: 'Ein Zuhause' },
    task: { en: 'In the Garden tab, place a fern in the terrarium.', de: 'Setze im Reiter Garten einen Farn ins Terrarium.' },
    why: { en: 'What you place becomes part of the fly\'s world: its eye sees it, and solid pieces are in the way.', de: 'Was du setzt, wird Teil der Welt der Fliege: Ihr Auge sieht es, und feste Stücke stehen im Weg.' } },
  { id: 'shadow', chapter: 'meet', kind: 'discover', targets: ['takeoff'], xp: 50, leaves: 15,
    title: { en: 'A shadow from above', de: 'Ein Schatten von oben' },
    task: { en: 'Move the mouse quickly toward {name}, like a predator. Then let things calm down again.', de: 'Bewege die Maus schnell auf {name} zu, wie ein Räuber. Lass danach wieder Ruhe einkehren.' },
    why: { en: 'A fast-growing dark shape drives LC4 and LPLC2; one giant-fiber spike means takeoff.', de: 'Eine schnell wachsende dunkle Form treibt LC4 und LPLC2; ein Spike der Riesenfaser heisst Abflug.' } },
  { id: 'turns', chapter: 'brain', kind: 'discover', targets: ['turnLeft', 'turnRight'], xp: 60, leaves: 15,
    title: { en: 'Left or right', de: 'Links oder rechts' },
    task: { en: 'Watch {name} turn both ways.', de: 'Beobachte {name} in beide Richtungen abbiegen.' },
    why: { en: 'Steering is a comparison: DNa01/02 on the left against the right.', de: 'Lenken ist ein Vergleich: DNa01/02 links gegen rechts.' } },
  { id: 'bitter', chapter: 'brain', kind: 'bitterRefusal', xp: 70, leaves: 20,
    title: { en: 'Bitter is different', de: 'Bitter ist anders' },
    task: { en: 'Offer a bitter drop (Bitter). Does {name} drink it?', de: 'Biete einen bitteren Tropfen an (Bitter). Trinkt {name} davon?' },
    why: { en: 'Bitter neurons hold back the proboscis: the same motor neurons, opposite input.', de: 'Bitterneuronen halten den Rüssel zurück: dieselben Motorneuronen, gegenteiliger Eingang.' } },
  { id: 'dose', chapter: 'brain', kind: 'dose', xp: 80, leaves: 20,
    title: { en: 'How sweet must it be?', de: 'Wie süss muss es sein?' },
    task: { en: 'Offer {name} drops of 60, 80 and 100 % sugar (buttons below). Which ones bring the proboscis out?',
      de: 'Biete {name} Tropfen mit 60, 80 und 100 % Zucker an (Knöpfe unten). Bei welchen kommt der Rüssel heraus?' },
    why: { en: 'Real flies extend the proboscis more often the sweeter the drop. The model\'s taste circuit has a threshold too: find it between two drops.',
      de: 'Echte Fliegen strecken den Rüssel umso öfter aus, je süsser der Tropfen ist. Auch der Geschmackskreis des Modells hat eine Schwelle: Finde sie zwischen zwei Tropfen.' } },
  { id: 'climate', chapter: 'brain', kind: 'climate', xp: 70, leaves: 20,
    title: { en: 'Feeling warmth', de: 'Wärme spüren' },
    task: { en: 'Warm the terrarium to 30 °C until the hot cells fire, then bring it back to 25 °C.', de: 'Wärme das Terrarium auf 30 °C, bis die Wärmezellen feuern, und stelle es dann zurück auf 25 °C.' },
    why: { en: 'Real hot cells of the antenna report warming; 24-26 °C is where flies gather in a gradient.', de: 'Echte Wärmezellen der Antenne melden Erwärmung; bei 24-26 °C sammeln sich Fliegen in einem Gefälle.' } },
  { id: 'moon', chapter: 'brain', kind: 'discover', targets: ['backward'], xp: 80, leaves: 20,
    title: { en: 'Moonwalk', de: 'Moonwalk' },
    task: { en: 'Find a moonwalk: rare on its own; in the Stimulate workspace "Backward" drives MDN directly.', de: 'Finde einen Moonwalk: von selbst selten; im Arbeitsbereich Stimulieren treibt «Rückwärts» die MDN direkt an.' },
    why: { en: 'Four MDN neurons are enough to reverse the walk.', de: 'Vier MDN-Neuronen genügen, um den Lauf umzukehren.' } },
  { id: 'cross', chapter: 'genetics', kind: 'cross', xp: 60, leaves: 0,
    title: { en: 'Your first cross', de: 'Deine erste Kreuzung' },
    task: { en: 'In the fly lab, cross DNp01-GAL4 with UAS-Kir2.1.', de: 'Kreuze im Fliegenlabor DNp01-GAL4 mit UAS-Kir2.1.' },
    why: { en: 'GAL4 marks the giant fiber, UAS-Kir2.1 silences wherever GAL4 is: the F1 has a silent giant fiber.', de: 'GAL4 markiert die Riesenfaser, UAS-Kir2.1 macht dort stumm, wo GAL4 ist: Die F1 hat eine stumme Riesenfaser.' } },
  { id: 'hatch', chapter: 'genetics', kind: 'collect', xp: 60, leaves: 10,
    title: { en: 'Hatched', de: 'Geschlüpft' },
    task: { en: 'Wait for the vial and collect the F1 fly.', de: 'Warte, bis das Röhrchen so weit ist, und hole die F1-Fliege heraus.' },
    why: { en: 'Egg, larva, pupa, fly: in game time minutes, in a real fly room about ten days.', de: 'Ei, Larve, Puppe, Fliege: im Spiel Minuten, im echten Fliegenraum etwa zehn Tage.' } },
  { id: 'silent', chapter: 'genetics', kind: 'silentEscape', xp: 120, leaves: 30, gift: ['dng12', 'chrimson'],
    title: { en: 'No escape without the giant fiber', de: 'Keine Flucht ohne Riesenfaser' },
    task: { en: 'Put the F1 fly into the terrarium and approach it like a shadow again.', de: 'Setze die F1-Fliege ins Terrarium und nähere dich wieder wie ein Schatten.' },
    why: { en: 'The looming detectors still fire, but the command neuron is silent: a dodge on foot at most.', de: 'Die Annäherungsdetektoren feuern weiterhin, doch das Kommandoneuron schweigt: höchstens ein Ausweichen zu Fuss.' } },
  { id: 'opto', chapter: 'genetics', kind: 'opto', xp: 120, leaves: 30, gift: ['mdn', 'trpa1'],
    title: { en: 'Grooming at the flick of a switch', de: 'Putzen auf Knopfdruck' },
    task: { en: 'Cross DNg12-GAL4 with UAS-CsChrimson, put the F1 in the terrarium and switch on the red light.', de: 'Kreuze DNg12-GAL4 mit UAS-CsChrimson, setze die F1 ins Terrarium und schalte das Rotlicht ein.' },
    why: { en: 'Optogenetics: light opens a channel in exactly the cells GAL4 marks.', de: 'Optogenetik: Licht öffnet einen Kanal genau in den Zellen, die GAL4 markiert.' } },
  { id: 'heat', chapter: 'genetics', kind: 'heatSwitch', xp: 120, leaves: 30,
    title: { en: 'A heat switch', de: 'Ein Wärmeschalter' },
    task: { en: 'Cross MDN-GAL4 with UAS-TrpA1, put the F1 into the terrarium and warm it to 30 °C.', de: 'Kreuze MDN-GAL4 mit UAS-TrpA1, setze die F1 ins Terrarium und wärme es auf 30 °C.' },
    why: { en: 'Thermogenetics: warmth opens TrpA1 in the moonwalker neurons. Cool it down again and the switch closes.', de: 'Thermogenetik: Wärme öffnet TrpA1 in den Moonwalker-Neuronen. Kühl es wieder ab, und der Schalter schliesst.' } },
  { id: 'evidence', chapter: 'question', kind: 'criteria', n: 4, xp: 150, leaves: 40,
    title: { en: 'Evidence, not opinion', de: 'Belege statt Meinung' },
    task: { en: 'Investigate four of the eight sentience criteria (tab "Big question").', de: 'Untersuche vier der acht Empfindungskriterien (Reiter «Grosse Frage»).' },
    why: { en: 'Birch and colleagues proposed eight criteria; scientists rate animals by the evidence for each.', de: 'Birch und Kolleginnen schlugen acht Kriterien vor; Fachleute bewerten Tiere nach den Belegen für jedes.' } },
  { id: 'atlas', chapter: 'question', kind: 'criteria', n: 8, xp: 250, leaves: 60,
    title: { en: 'The whole atlas', de: 'Der ganze Atlas' },
    task: { en: 'Investigate all eight criteria.', de: 'Untersuche alle acht Kriterien.' },
    why: { en: 'The answer the model can give is a map of mechanisms, not a verdict on feelings.', de: 'Die Antwort, die das Modell geben kann, ist eine Karte von Mechanismen, kein Urteil über Gefühle.' } },
]);

// ---- daily field notes ----------------------------------------------------------------------
export const DAILY = Object.freeze([
  { id: 'feed3', kind: 'event', targets: ['feeding'], n: 3, title: { en: 'Feed 3 times', de: '3 Mal fressen lassen' } },
  { id: 'groom2', kind: 'event', targets: ['headGrooming', 'legGrooming'], n: 2, title: { en: 'See 2 grooming bouts', de: '2 Putzaktionen beobachten' } },
  { id: 'turns5', kind: 'event', targets: ['turnLeft', 'turnRight'], n: 5, title: { en: 'See 5 turns', de: '5 Kurven beobachten' } },
  { id: 'calm3', kind: 'calm', n: 180, title: { en: '3 calm minutes (calm above 80)', de: '3 ruhige Minuten (Ruhe über 80)' } },
  { id: 'card', kind: 'card', n: 1, title: { en: 'Discover a neuron card or see 10 behaviours', de: 'Eine Neuronenkarte entdecken oder 10 Verhalten sehen' } },
  { id: 'vial', kind: 'vial', n: 1, title: { en: 'Start a vial', de: 'Ein Röhrchen ansetzen' } },
  { id: 'live5', kind: 'live', n: 300, title: { en: '5 minutes in the terrarium', de: '5 Minuten im Terrarium' } },
  { id: 'walk60', kind: 'walking', n: 60, title: { en: 'Walk for a minute in total', de: 'Insgesamt eine Minute laufen' } },
  { id: 'garden', kind: 'garden', n: 1, title: { en: 'Place something in the terrarium', de: 'Etwas ins Terrarium setzen' } },
]);
export const DAILY_REWARD = Object.freeze({ task: { xp: 20, leaves: 10 }, bonus: { xp: 30, leaves: 25 } });

// ---- the big question: Birch et al. (2021) criteria (sentience.js) ----------------------------
// How each criterion is investigated in the game: a quest, a Lab protocol,
// reading the evidence, or several sensory modalities seen.
export const CRITERIA = Object.freeze([
  { id: 'nociception', via: { quest: ['bitter', 'climate'] },
    how: { en: 'Meet the cells that detect harmful stimuli: bitter taste and heat.', de: 'Lerne die Zellen kennen, die Schädliches erkennen: Bitteres und Hitze.' } },
  { id: 'sensory-integration', via: { modalities: 3 },
    how: { en: 'See responses from three senses: vision, antenna, taste or temperature.', de: 'Erlebe Antworten aus drei Sinnen: Sehen, Antenne, Geschmack oder Temperatur.' } },
  { id: 'integrated-nociception', via: { read: true },
    how: { en: 'Read the anatomy: do the harm sensors reach learning centres?', de: 'Lies die Anatomie: Erreichen die Schadenssensoren Lernzentren?' } },
  { id: 'analgesia', via: { lab: 'inhibition-escape' },
    how: { en: 'Run the Lab protocol on inhibition and escape.', de: 'Führe im Labor das Protokoll zu Hemmung und Flucht durch.' } },
  { id: 'motivational-tradeoffs', via: { lab: 'taste-tradeoff' },
    how: { en: 'Run the Lab protocol on sugar against bitter.', de: 'Führe im Labor das Protokoll Zucker gegen Bitter durch.' } },
  { id: 'flexible-self-protection', via: { quest: ['dust'] },
    how: { en: 'See how the fly cleans the affected body part.', de: 'Sieh, wie die Fliege den betroffenen Körperteil reinigt.' } },
  { id: 'associative-learning', via: { lab: 'associative' },
    how: { en: 'Run the Lab protocol on associative pairing.', de: 'Führe im Labor das Protokoll zur assoziativen Paarung durch.' } },
  { id: 'analgesia-preference', via: { read: true },
    how: { en: 'Read why this cannot be tested in the model.', de: 'Lies, warum sich das im Modell nicht prüfen lässt.' } },
]);

export const MODALITY_LABEL = Object.freeze({
  vision: { en: 'vision', de: 'Sehen' }, mechano: { en: 'antenna', de: 'Antenne' },
  taste: { en: 'taste', de: 'Geschmack' }, thermo: { en: 'temperature', de: 'Temperatur' },
});

export const byId = (list, id) => list.find((x) => x.id === id) ?? null;

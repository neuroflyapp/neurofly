// sentience.js — the eight evidence criteria for sentience (Birch et al. 2021),
// for the real fly and for this model, side by side. Deliberately NOT a
// sentience detector or score.
//
// No accepted measurement turns a simulated spike train into evidence of felt
// experience. What science does have is a set of criteria used to weigh how
// likely it is that an animal can feel pain: four neurobiological, four
// behavioural (Birch, Burn, Schnell, Browning & Crump 2021). Gibbons et al.
// (2022) applied them to insects; for adult flies (Diptera) they rated six of
// the eight as met with high or very high confidence — "strong evidence" in
// the framework's grading — and found no research at all on the other two.
//
// For each criterion this module reports three things, each labelled for what
// it is:
//   animal   — the published confidence rating for real adult flies;
//   anatomy  — what the complete FlyWire connectome shows (measured);
//   model    — what the simulated circuit contains, and which in-silico
//              experiment tests the corresponding capacity.
// A capacity reproduced in the model is a statement about the model's
// mechanisms, not evidence that the model, or the fly, feels anything.

export const SENTIENCE_RESEARCH_SOURCES = Object.freeze([
  {
    label: 'Birch, Burn, Schnell, Browning & Crump (2021), Review of the Evidence of Sentience in Cephalopod Molluscs and Decapod Crustaceans, LSE Consulting',
    url: 'https://www.lse.ac.uk/business/consulting/reports/review-of-the-evidence-of-sentiences-in-cephalopod-molluscs-and-decapod-crustaceans',
    point: 'Source of the eight criteria (4 neurobiological, 4 behavioural).',
  },
  {
    label: 'Gibbons, Crump, Barrett, Sarlak, Birch & Chittka (2022), Can insects feel pain? A review of the neural and behavioural evidence, Advances in Insect Physiology 63:155–229',
    url: 'https://doi.org/10.1016/bs.aiip.2022.10.001',
    point: 'Applies the eight criteria to insects (Table 11): adult Diptera meet six with high or very high confidence — strong evidence for pain in the real animal.',
  },
  {
    label: 'New York Declaration on Animal Consciousness (2024)',
    url: 'https://sites.google.com/nyu.edu/nydeclaration',
    point: 'A realistic possibility of consciousness in insects, with the uncertainty stated.',
  },
  {
    label: 'Barron & Klein (2016), What insects can tell us about the origins of consciousness, PNAS 113:4900–4908',
    url: 'https://doi.org/10.1073/pnas.1520084113',
    point: 'Comparative structural/functional argument centred on the insect midbrain-like structures.',
  },
  {
    label: 'Ueno et al. (2017), Coincident postsynaptic activity gates presynaptic dopamine release to induce plasticity in Drosophila mushroom bodies, eLife 6:e21076',
    url: 'https://elifesciences.org/articles/21076',
    point: 'Fly associative plasticity is dopamine-gated and located in the mushroom body.',
  },
  {
    label: 'Engel & Wu (1996), Altered habituation of an identified escape circuit in Drosophila memory mutants, J Neurosci 16:3486–3499',
    url: 'https://pubmed.ncbi.nlm.nih.gov/8627381/',
    point: 'The giant-fiber escape pathway habituates in real flies (non-associative learning).',
  },
  {
    label: 'Shiu et al. (2024), A Drosophila computational brain model reveals sensorimotor processing, Nature 634:210–219',
    url: 'https://doi.org/10.1038/s41586-024-07763-9',
    point: 'Whole-brain FlyWire LIF: sugar activates proboscis motor neurons, bitter suppresses them.',
  },
  {
    label: 'Guo, Zhang & Simpson (2022), Descending neurons coordinate anterior grooming behavior in Drosophila, Current Biology 32:823–833',
    url: 'https://doi.org/10.1016/j.cub.2021.12.055',
    point: 'DNg12 drives head sweeps with leg rubbing; DNg11 drives leg rubbing.',
  },
  {
    label: 'Hampel et al. (2020), Distinct subpopulations of mechanosensory chordotonal organ neurons elicit grooming of the fruit fly antennae, eLife 9:e59976',
    url: 'https://doi.org/10.7554/eLife.59976',
    point: 'JO-F neurons elicit antennal grooming.',
  },
  {
    label: 'Yorozu et al. (2009), Distinct sensory representations of wind and near-field sound in the Drosophila brain, Nature 458:201–205',
    url: 'https://www.nature.com/articles/nature07843',
    point: 'JO-A/B sound versus JO-C/E wind populations.',
  },
  {
    label: 'Kamikouchi et al. (2009), The neural basis of Drosophila gravity-sensing and hearing, Nature 458:165–171',
    url: 'https://www.nature.com/articles/nature07810',
    point: 'Vibration- versus deflection-sensitive JO neurons.',
  },
]);

export const STATUS = Object.freeze({
  present: 'present',
  partial: 'partial',
  experimental: 'experimental',
  absent: 'absent',
  notAssessed: 'not-assessed',
  notMeasurable: 'not-measurable',
});

// Gibbons et al. (2022), Table 11, adult Diptera.
export const ANIMAL_RATINGS = Object.freeze({
  nociception: 'VH', 'sensory-integration': 'VH', 'integrated-nociception': 'VH', analgesia: 'VH',
  'motivational-tradeoffs': 'H', 'flexible-self-protection': 'VL', 'associative-learning': 'VH', 'analgesia-preference': 'VL',
});

const MB_RE = /^(KC|MBON|PAM|PPL|APL|DPM)/;
const MB_LEARNING_RE = /^(KC|PAM|PPL)/;
const CX_RE = /^(EPG|PEG|PEN|PFN|PFL|PFR|PFG|hDelta|vDelta|FB\d|ER\d|ExR|EL)/;

function countTypes(circuit, re) {
  let total = 0;
  const found = {};
  for (const n of circuit?.neurons || []) {
    const t = n.cellType;
    if (t && re.test(t)) { found[t] = (found[t] || 0) + 1; total++; }
  }
  return { total, found };
}

export function assessSentience({ circuit = null, provenance = null, pathways = null, hasPlasticity = false } = {}) {
  const neurons = circuit?.neurons || [];
  const count = (pred) => neurons.filter(pred).length;
  const hot = count((n) => n.thermoGroup === 'hot'), cold = count((n) => n.thermoGroup === 'cold');
  // Existing core receptors receive extensionTag instead of being appended
  // twice. Count the same input targets as LIFSim's *Drive populations.
  const receptor = (n, extension, group) => (n.extension === extension && n.sensoryGroup === group)
    || (!n.extension && n.extensionTag?.sensoryGroup === group);
  const bitter = count((n) => receptor(n, 'taste', 'bitter'));
  const sugar = count((n) => receptor(n, 'taste', 'sugar'));
  const proboscis = count((n) => n.extension === 'taste' && n.motorGroup);
  const joF = count((n) => receptor(n, 'grooming', 'jof'));
  const dng12 = count((n) => n.extension === 'grooming' && n.motorGroup === 'dng12');
  const mb = countTypes(circuit, MB_RE), mbLearn = countTypes(circuit, MB_LEARNING_RE), cx = countTypes(circuit, CX_RE);
  // The legacy full-brain route table is FAFB, even when the live fly uses
  // MaleCNS or BANC. Cross-specimen reference paths are not evidence about
  // this animal's graph. An unidentified table never counts as a match.
  const runningBrainId = provenance?.specimens?.brain?.id
    ?? ({ mixed: 'fafb-v783', male: 'malecns-v1', female: 'banc-v888' }[provenance?.flyModel])
    ?? (/FAFB v783/.test(circuit?.source || '') ? 'fafb-v783' : null);
  const pathwayBrainId = pathways?.specimenId
    ?? (/FAFB v783/.test(pathways?.source || '') ? 'fafb-v783' : null);
  const pathwayMatches = !!runningBrainId && runningBrainId === pathwayBrainId;
  const anatomicalAnalysis = Object.freeze({
    status: !pathways ? 'absent' : pathwayMatches ? 'matched-specimen' : 'unmatched-reference',
    runningBrainId, pathwayBrainId,
    runningBrain: provenance?.specimens?.brain?.name ?? circuit?.source ?? null,
    source: pathways?.source ?? null,
    scope: 'Full-graph anatomical routes do not establish retained or dynamically effective routes in a reduced simulation.',
  });
  const route = (src, region) => pathwayMatches ? pathways?.sources?.[src]?.regions?.[region] ?? null : null;
  const hotMB = route('hot', 'mushroomBody'), bitterMB = route('bitter', 'mushroomBody'), hotCX = route('hot', 'centralComplex');

  const criteria = [
    {
      id: 'nociception', n: 1, group: 'neurobiological', name: 'Nociception',
      question: 'Does it have receptors that detect noxious stimuli?',
      status: hot + cold + bitter > 0 ? STATUS.partial : STATUS.absent,
      model: { hot, cold, bitter },
      protocol: 'taste-tradeoff',
    },
    {
      id: 'sensory-integration', n: 2, group: 'neurobiological', name: 'Sensory integration',
      question: 'Does it have brain regions that integrate information from different senses?',
      status: cx.total + mb.total > 0 ? STATUS.partial : STATUS.absent,
      model: { centralComplex: cx.total, mushroomBody: mb.total, mushroomBodyLearningCells: mbLearn.total },
    },
    {
      id: 'integrated-nociception', n: 3, group: 'neurobiological', name: 'Integrated nociception',
      question: 'Are the noxious-stimulus receptors connected to those integrative regions?',
      status: !pathwayMatches ? STATUS.notAssessed : hotMB || bitterMB ? STATUS.partial : STATUS.absent,
      anatomy: pathwayMatches ? { hotToMushroomBody: hotMB, bitterToMushroomBody: bitterMB, hotToCentralComplex: hotCX } : null,
      anatomicalAnalysis,
    },
    {
      id: 'analgesia', n: 4, group: 'neurobiological', name: 'Analgesia',
      question: 'Is the response to noxious stimuli modulated by analgesics, anaesthetics or the nervous system itself?',
      status: STATUS.experimental,
      protocol: 'inhibition-escape',
    },
    {
      id: 'motivational-tradeoffs', n: 5, group: 'behavioural', name: 'Motivational trade-offs',
      question: 'Does it weigh a noxious stimulus against a reward?',
      status: sugar && bitter && proboscis ? STATUS.partial : STATUS.absent,
      model: { sugar, bitter, proboscis },
      protocol: 'taste-tradeoff',
    },
    {
      id: 'flexible-self-protection', n: 6, group: 'behavioural', name: 'Flexible self-protection',
      question: 'Does it tend to the affected body part — grooming, guarding, wound-directed care?',
      status: joF && dng12 ? STATUS.partial : STATUS.absent,
      model: { joF, dng12 },
      protocol: 'dust-grooming',
    },
    {
      id: 'associative-learning', n: 7, group: 'behavioural', name: 'Associative learning',
      question: 'Can it learn to associate a noxious stimulus with a neutral one?',
      status: hasPlasticity ? STATUS.experimental : STATUS.absent,
      model: { mushroomBodyLearningCells: mbLearn.total, learningRuleAvailable: true },
      protocol: 'associative',
    },
    {
      id: 'analgesia-preference', n: 8, group: 'behavioural', name: 'Analgesia preference',
      question: 'When injured, does it seek out or value painkillers?',
      status: STATUS.absent,
    },
  ];
  for (const c of criteria) c.animal = ANIMAL_RATINGS[c.id];
  const subjective = { id: 'subjective-experience', name: 'Subjective experience', status: STATUS.notMeasurable };
  // Kept apart on purpose: a mechanism partly present in the circuit, a
  // tentative mechanism that is not the fly's own ("experimental"), and none.
  // They are never added up into one number, and never set against the
  // animal ratings, which grade evidence about real flies.
  const counts = {
    partial: criteria.filter((c) => c.status === STATUS.partial).length,
    experimental: criteria.filter((c) => c.status === STATUS.experimental).length,
    absent: criteria.filter((c) => c.status === STATUS.absent).length,
    notAssessed: criteria.filter((c) => c.status === STATUS.notAssessed).length,
  };
  const animalStrong = criteria.filter((c) => c.animal === 'VH' || c.animal === 'H').length;
  return Object.freeze({
    framework: 'Birch et al. (2021), 8 criteria; animal ratings: Gibbons et al. (2022), Table 11, adult Diptera',
    criteriaCount: criteria.length,
    criteria,
    items: [...criteria, subjective],
    counts,
    animalStrong,
    anatomicalAnalysis,
    conclusion: 'Evidence map against the Birch et al. (2021) criteria — not a sentience score and not a proof of feeling.',
    provenanceStatus: { thermo: provenance?.thermoExtensionStatus ?? 'absent', sensory: provenance?.sensoryExtensionStatus ?? 'absent' },
  });
}

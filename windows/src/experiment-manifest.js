// experiment-manifest.js -- a compact, self-describing companion to a run's
// CSV traces and screenshots. It stores declared model choices and measured
// provenance, not an invented account of an animal's internal experience.

import { brainVncCoupling } from './provenance.js';

export const MANIFEST_SCHEMA = 'neurofly-run-manifest/2';

function finiteNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

// Copy compact metadata, not the circuit itself. Exported manifests must not
// change when the live protocol's status or the source summary is updated.
function metadataSnapshot(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return finiteNumber(value);
  if (Array.isArray(value)) return Object.freeze(value.map(metadataSnapshot));
  if (typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value)
      .filter(([, item]) => typeof item !== 'function')
      .map(([key, item]) => [key, metadataSnapshot(item)])));
  }
  return value;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function makeExperimentManifest({
  createdAt = new Date().toISOString(),
  modelVersion = '',
  neuralSeed = null,
  data = null,
  plasticity = null,
  protocol = null,
  protocolHistory = null,
  neuralTimeMs = null,
  performance = null,
  session = null,
  environment = null,
  body = null,
  interventions = null,
  simulation = null,
} = {}) {
  const provenance = data?.provenance || {};
  const audit = provenance.brainAudit || {};
  const runningNeurons = count(data?.circuit?.neurons?.length);
  const runningEdges = count(data?.circuit?.edges?.length);
  // The hash and brainAudit identify the published base file, not the merged
  // thermosensory circuit currently integrated by the simulator.
  const hasExtension = provenance.thermoExtensionStatus === 'attached' || provenance.sensoryExtensionStatus === 'attached';
  const baseNeurons = count(audit.neurons) ?? (!hasExtension ? runningNeurons : null);
  const baseEdges = count(audit.edges) ?? (!hasExtension ? runningEdges : null);
  const addedCount = (running, base) => running !== null && base !== null && running >= base
    ? running - base : null;
  const coupling = brainVncCoupling(simulation);
  // Actual Float32 thresholds, not a rounded declaration. An explicit test
  // override can differ from data.js's calibration, so record both separately.
  const gfThresholds = simulation?.gf && simulation?.thresholds
    ? [...new Set(Array.from(simulation.gf, (i) => finiteNumber(simulation.thresholds[i])))] : null;
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    createdAt,
    session: metadataSnapshot(session),
    environment: metadataSnapshot(environment),
    body: metadataSnapshot(body),
    interventions: metadataSnapshot(interventions),
    reproducibility: 'Neural seed controls neural noise for identical input. Environmental snapshot and intervention journal do not constitute a full-state checkpoint or deterministic replay.',
    model: Object.freeze({
      version: modelVersion,
      neuralSeed: finiteNumber(neuralSeed),
      neuralTimeMs: finiteNumber(neuralTimeMs),
      neuralIntegrator: '1-ms leaky integrate-and-fire',
      flyModel: provenance.flyModel ?? null,
      brainVncBridge: coupling.label,
      brainVncCoupling: coupling,
      parameters: Object.freeze({
        coreWeightPerSynapse: finiteNumber(simulation?.weightScale),
        coreSynapseScale: finiteNumber(simulation?.synapseScale),
        pathwayWeightPerSynapse: finiteNumber(simulation?.pathwayWeight),
        pathwayRecurrentFraction: finiteNumber(simulation?.pathwayRecurrent),
        pathwayEdgeCap: finiteNumber(simulation?.pathwayCap),
        giantFiberThresholds: metadataSnapshot(gfThresholds),
        arousalScale: finiteNumber(simulation?.arousalScale),
        cordParameters: metadataSnapshot(simulation?.locomotor?.parameters),
        steppingRulesActive: simulation?.locomotor === undefined ? null : !!simulation.locomotor?.stepper,
        steppingRuleParameters: metadataSnapshot(simulation?.locomotor?.stepper?.p),
        scope: 'Model parameters, not measured cell physiology. Brain efficacy and thresholds use normalised membrane units; synapse scales, recurrence fractions and arousal scales are dimensionless.',
      }),
      declaredCalibration: metadataSnapshot({
        synapseScale: finiteNumber(data?.circuit?.synapseScale),
        gfThreshold: finiteNumber(data?.circuit?.gfThreshold),
        pathwayCalibration: data?.circuit?.pathwayCalibration ?? null,
        arousalScale: finiteNumber(data?.circuit?.arousalScale),
      }),
    }),
    data: Object.freeze({
      specimens: metadataSnapshot(provenance.specimens),
      // Legacy names continue to refer to the base bundle. New consumers
      // should use the explicit base/running fields below.
      brainNeurons: baseNeurons,
      brainEdges: baseEdges,
      baseBrainNeurons: baseNeurons,
      baseBrainEdges: baseEdges,
      runningBrainNeurons: runningNeurons,
      runningBrainEdges: runningEdges,
      addedBrainNeurons: addedCount(runningNeurons, baseNeurons),
      addedBrainEdges: addedCount(runningEdges, baseEdges),
      vncNeurons: data?.locomotor?.neurons?.length ?? null,
      vncEdges: data?.locomotor?.edges?.length ?? null,
      brainBundleSHA256: provenance.brainCircuitSHA256 ?? null,
      vncBundleSHA256: provenance.locomotorSHA256 ?? null,
      brainPointsSHA256: provenance.brainPointsSHA256 ?? null,
      brainSource: data?.circuit?.source ?? null,
      brainSources: metadataSnapshot(data?.circuit?.sources),
      brainCoordinateRegistration: metadataSnapshot(data?.circuit?.frame),
      brainCoordinateRegistrationScope: 'Coordinate fit for display, not physiological calibration or identity matching between animals.',
      vncSource: data?.locomotor?.source ?? null,
      vncContentSHA256: provenance.locomotorContentSHA256 ?? null,
      rhythmDecoderSHA256: provenance.rhythmDecoderSHA256 ?? null,
      rhythmDecoderStatus: provenance.rhythmDecoderStatus ?? 'absent',
      rhythmDecoder: metadataSnapshot(provenance.rhythmDecoder),
      structuralAuditValid: typeof audit.valid === 'boolean' ? audit.valid : null,
      structuralAuditScope: 'base-brain-bundle',
      // Which FlyWire cell-type annotation (if any) decided how stimuli were
      // routed to the Johnston's-organ populations. Without it a run with the
      // corrected routing and one with the old all-in-one channel would look
      // identical in the manifest.
      cellAnnotationSHA256: provenance.annotationSHA256 ?? null,
      cellAnnotationStatus: provenance.annotationStatus ?? 'absent',
      sensoryGroupCounts: metadataSnapshot(provenance.sensoryGroupCounts),
      // Whether temperature reached real thermosensory cells in this run, and
      // how much larger than circuit.json the running circuit was.
      thermoExtensionSHA256: provenance.thermoExtensionSHA256 ?? null,
      thermoExtensionStatus: provenance.thermoExtensionStatus ?? 'absent',
      thermoExtension: metadataSnapshot(provenance.thermoExtension),
      sensoryExtensionSHA256: provenance.sensoryExtensionSHA256 ?? null,
      sensoryExtensionStatus: provenance.sensoryExtensionStatus ?? 'absent',
      sensoryExtension: metadataSnapshot(provenance.sensoryExtension),
    }),
    plasticity: Object.freeze({
      enabled: typeof plasticity?.enabled === 'boolean' ? plasticity.enabled : null,
      mechanism: plasticity?.mechanism ?? null,
      tauMs: finiteNumber(plasticity?.tauMs),
      learningRate: finiteNumber(plasticity?.learningRate),
      maxRelativeChange: finiteNumber(plasticity?.maxRelativeChange),
      eligibleEdges: finiteNumber(plasticity?.eligibleEdges),
      updates: finiteNumber(plasticity?.updates),
      potentiations: finiteNumber(plasticity?.potentiations),
      depressions: finiteNumber(plasticity?.depressions),
      meanAbsRelativeChange: finiteNumber(plasticity?.meanAbsRelativeChange),
      weightBasis: plasticity?.weightBasis ?? null,
      blockedClassLearning: plasticity?.blockedClassLearning ?? null,
      changeScope: 'cumulative-since-neural-restart',
    }),
    // Stimulus schedules are interventions, not proof that they caused every
    // cumulative weight update. Preserve their timing and targets, including
    // earlier schedules in the same neural run when the caller supplies them.
    protocol: metadataSnapshot(protocol),
    protocolHistory: Array.isArray(protocolHistory) ? metadataSnapshot(protocolHistory) : null,
    protocolAttribution: 'descriptive-interventions-not-per-contact-causal-attribution',
    performance: Object.freeze({
      windowSeconds: finiteNumber(performance?.windowSeconds),
      fps: finiteNumber(performance?.fps),
      simulationRealtime: finiteNumber(performance?.simulationRealtime),
      coreRealtime: finiteNumber(performance?.coreRealtime),
      droppedSecondsPerSecond: finiteNumber(performance?.droppedSecondsPerSecond),
      totalDroppedSimulationSeconds: finiteNumber(performance?.totalDroppedSimulationSeconds),
      runDroppedSimulationSeconds: finiteNumber(performance?.runDroppedSimulationSeconds),
    }),
  });
}

export function experimentManifestJSON(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

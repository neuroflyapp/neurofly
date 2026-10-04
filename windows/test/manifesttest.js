// manifesttest.js -- preserve the experimental context that CSV rows alone
// cannot hold without becoming needlessly repetitive.

import { experimentManifestJSON, makeExperimentManifest, MANIFEST_SCHEMA } from '../src/experiment-manifest.js';

let failures = 0;
function check(name, fn) {
  const [ok, detail] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

check('manifest preserves provenance, model choices and bounded learning statistics', () => {
  const manifest = makeExperimentManifest({
    createdAt: '2026-09-15T12:00:00.000Z',
    modelVersion: '1.2.0',
    neuralSeed: 1234,
    data: {
      circuit: { neurons: Array(4), edges: Array(7) },
      locomotor: { neurons: Array(2), edges: Array(3) },
      provenance: {
        brainCircuitSHA256: 'brainhash', locomotorSHA256: 'vnchash',
        brainAudit: { valid: true, neurons: 4, edges: 7 },
      },
    },
    plasticity: { enabled: true, mechanism: 'bounded-pair-stdp', tauMs: 20, learningRate: 0.02, maxRelativeChange: 0.15,
      eligibleEdges: 2, updates: 5, potentiations: 3, depressions: 2, meanAbsRelativeChange: 0.04,
      weightBasis: 'unmodulated synaptic efficacy', blockedClassLearning: 'paused at zero transmitter gain (model assumption)' },
    protocol: { name: 'visual-to-flight-alarm', pairOrder: 'pre-before-post', trials: 16, delayMs: 8, intervalMs: 140 },
    performance: { windowSeconds: 0.5, fps: 60, simulationRealtime: 1, coreRealtime: 4, droppedSecondsPerSecond: 0,
      totalDroppedSimulationSeconds: 0.4, runDroppedSimulationSeconds: 0.1 },
  });
  const ok = manifest.schema === MANIFEST_SCHEMA && manifest.model.neuralSeed === 1234
    && manifest.data.structuralAuditValid && manifest.data.brainEdges === 7
    && manifest.plasticity.updates === 5 && manifest.protocol?.pairOrder === 'pre-before-post'
    && manifest.plasticity.tauMs === 20 && manifest.plasticity.learningRate === 0.02
    && manifest.plasticity.maxRelativeChange === 0.15
    && manifest.plasticity.weightBasis === 'unmodulated synaptic efficacy'
    && manifest.plasticity.blockedClassLearning === 'paused at zero transmitter gain (model assumption)'
    && manifest.performance.totalDroppedSimulationSeconds === 0.4
    && manifest.performance.runDroppedSimulationSeconds === 0.1;
  return [ok, `seed=${manifest.model.neuralSeed}, edges=${manifest.data.brainEdges}, updates=${manifest.plasticity.updates}`];
});

check('manifest serialisation is valid JSON and does not emit non-finite values', () => {
  const text = experimentManifestJSON(makeExperimentManifest({
    neuralSeed: NaN,
    performance: { fps: Infinity },
  }));
  const parsed = JSON.parse(text);
  return [parsed.model.neuralSeed === null && parsed.performance.fps === null && !/NaN|Infinity/.test(text),
    `seed=${parsed.model.neuralSeed}, fps=${parsed.performance.fps}`];
});

check('running circuit counts are separate from the hashed base bundle and retain thermo provenance', () => {
  const data = {
    circuit: { neurons: Array(10), edges: Array(20) },
    provenance: {
      brainAudit: { valid: true, neurons: 7, edges: 12 },
      brainCircuitSHA256: 'base', annotationSHA256: 'annotations', annotationStatus: 'attached',
      sensoryGroupCounts: { auditory: 3 },
      thermoExtensionSHA256: 'thermo', thermoExtensionStatus: 'attached',
      thermoExtension: { addedNeurons: 3, addedEdges: 8, hotCells: 1, coldCells: 1 },
    },
  };
  const manifest = makeExperimentManifest({ data });
  const counts = manifest.data;
  data.provenance.thermoExtension.hotCells = 90;
  data.provenance.sensoryGroupCounts.auditory = 90;
  const ok = counts.baseBrainNeurons === 7 && counts.baseBrainEdges === 12
    && counts.runningBrainNeurons === 10 && counts.runningBrainEdges === 20
    && counts.addedBrainNeurons === 3 && counts.addedBrainEdges === 8
    && counts.brainNeurons === 7 && counts.brainEdges === 12
    && counts.thermoExtension.hotCells === 1 && counts.sensoryGroupCounts.auditory === 3
    && counts.cellAnnotationSHA256 === 'annotations' && counts.thermoExtensionSHA256 === 'thermo';
  return [ok, `${counts.baseBrainNeurons} base + ${counts.addedBrainNeurons} extension = ${counts.runningBrainNeurons} running`];
});

check('unknown telemetry stays unknown while measured zero is preserved', () => {
  const unknown = makeExperimentManifest();
  const measured = makeExperimentManifest({
    performance: { fps: 0, droppedSecondsPerSecond: 0 },
    plasticity: { enabled: false, mechanism: 'off', updates: 0 },
  });
  const ok = Object.values(unknown.performance).every((value) => value === null)
    && unknown.plasticity.enabled === null && unknown.plasticity.updates === null
    && unknown.plasticity.weightBasis === null && unknown.plasticity.blockedClassLearning === null
    && unknown.data.structuralAuditValid === null && unknown.data.runningBrainNeurons === null
    && measured.performance.fps === 0 && measured.performance.droppedSecondsPerSecond === 0
    && measured.plasticity.enabled === false && measured.plasticity.updates === 0;
  return [ok, `unknown fps=${unknown.performance.fps}, measured fps=${measured.performance.fps}`];
});

check('an unaudited extended circuit does not masquerade as a known base bundle', () => {
  const manifest = makeExperimentManifest({ data: {
    circuit: { neurons: Array(10), edges: Array(20) },
    provenance: { thermoExtensionStatus: 'attached' },
  } });
  return [manifest.data.runningBrainNeurons === 10 && manifest.data.baseBrainNeurons === null
    && manifest.data.addedBrainNeurons === null, 'running size retained; absent base audit is null'];
});

check('protocol snapshots preserve intervention history and neural timing without causal attribution', () => {
  const first = { id: 'trial-1', name: 'forward', scheduledAtSimMs: 0, endSimMs: 25, status: 'completed', targets: [1, 2] };
  const second = { id: 'trial-2', name: 'reverse', scheduledAtSimMs: 30, endSimMs: 55, status: 'running', delayMs: Infinity };
  const manifest = makeExperimentManifest({ protocol: second, protocolHistory: [first, second], neuralTimeMs: 42 });
  first.targets.push(3);
  second.status = 'completed';
  const ok = manifest.model.neuralTimeMs === 42 && manifest.protocol.status === 'running'
    && manifest.protocol.delayMs === null && manifest.protocolHistory.length === 2
    && manifest.protocolHistory[0].targets.length === 2
    && manifest.plasticity.changeScope === 'cumulative-since-neural-restart'
    && manifest.protocolAttribution.includes('not-per-contact-causal');
  return [ok, `history=${manifest.protocolHistory.length}, neural time=${manifest.model.neuralTimeMs} ms`];
});

check('actual shared-cell coupling and calibrated parameters are immutable metadata, not guessed from sex', () => {
  const simulation = {
    locomotor: { mirrorDescending: true, stepper: { p: { stanceLoad: 0.6, swingSpeed: 2 } }, parameters: { synapticGain: 2.4, rhythm: { speed: 1 } } },
    identityCoupled: true, identityPairs: { descending: 15, ascending: 18 },
    ascend: Array(221), ascendMirrored: Uint8Array.from({ length: 221 }, (_, i) => i < 18 ? 1 : 0),
    weightScale: 0.0002, synapseScale: 3.7, pathwayWeight: 0.0864, pathwayRecurrent: 0.025,
    pathwayCap: 0.5, arousalScale: 0.97, gf: [0, 1], thresholds: Float32Array.of(1.8, 1.8),
  };
  const data = { circuit: {
    neurons: Array(3), edges: Array(4), synapseScale: 3.7, gfThreshold: 1.8,
    arousalScale: 0.97, pathwayCalibration: { weightScale: 14, recurrentFraction: 0.025 },
    frame: { to: 'FAFB v783', rmsMicrometres: 44.9 },
    sources: { annotations: { sha256: 'native-source' } },
  }, provenance: { flyModel: 'female', rhythmDecoderSHA256: 'decoder', rhythmDecoderStatus: 'attached',
    rhythmDecoder: { decoders: 36 }, locomotorContentSHA256: 'lf-cord' } };
  const manifest = makeExperimentManifest({ data, simulation });
  simulation.identityPairs.descending = 999;
  simulation.thresholds.fill(5);
  simulation.locomotor.parameters.rhythm.speed = 999;
  simulation.locomotor.stepper.p.stanceLoad = 999;
  data.circuit.pathwayCalibration.weightScale = 999;
  data.circuit.frame.rmsMicrometres = 999;
  data.circuit.sources.annotations.sha256 = 'changed';
  const coupling = manifest.model.brainVncCoupling, params = manifest.model.parameters;
  const ok = manifest.model.flyModel === 'female' && coupling.mode === 'shared-cell-spike-transfer'
    && coupling.sharedDescendingCells === 15 && coupling.sharedAscendingCells === 18
    && coupling.populationRateAscendingTargets === 203 && coupling.populationRateDescendingDrive === false
    && params.coreSynapseScale === 3.7 && params.pathwayRecurrentFraction === 0.025
    && params.arousalScale === 0.97 && params.giantFiberThresholds[0] === Math.fround(1.8)
    && params.cordParameters.rhythm.speed === 1 && params.steppingRulesActive === true
    && params.steppingRuleParameters.stanceLoad === 0.6 && params.steppingRuleParameters.swingSpeed === 2
    && manifest.model.declaredCalibration.pathwayCalibration.weightScale === 14
    && manifest.data.brainCoordinateRegistration.rmsMicrometres === 44.9
    && manifest.data.brainSources.annotations.sha256 === 'native-source'
    && manifest.data.rhythmDecoderSHA256 === 'decoder' && manifest.data.vncContentSHA256 === 'lf-cord';
  return [ok, `${coupling.sharedDescendingCells}/${coupling.sharedAscendingCells} shared cells; ${coupling.populationRateAscendingTargets} unmatched rate-feedback targets`];
});

check('unknown runtime coupling is not silently labelled as a measured cross-specimen bridge', () => {
  const unknown = makeExperimentManifest({ data: { provenance: { flyModel: 'male' } } });
  const incomplete = makeExperimentManifest({ simulation: { locomotor: {} } });
  const absent = makeExperimentManifest({ simulation: { locomotor: null } });
  const ok = unknown.model.brainVncCoupling.mode === 'unreported'
    && unknown.model.brainVncCoupling.sharedDescendingCells === null
    && unknown.model.parameters.coreSynapseScale === null && unknown.model.parameters.steppingRulesActive === null
    && unknown.model.parameters.steppingRuleParameters === null
    && incomplete.model.brainVncCoupling.mode === 'unreported'
    && absent.model.brainVncCoupling.mode === 'no-nerve-cord'
    && absent.model.brainVncCoupling.sharedDescendingCells === 0 && absent.model.parameters.steppingRulesActive === false;
  return [ok, `unknown=${unknown.model.brainVncCoupling.mode}; absent=${absent.model.brainVncCoupling.mode}`];
});

console.log(failures === 0 ? 'ALL MANIFEST TESTS PASS' : `${failures} MANIFEST TESTS FAILED`);
process.exit(failures === 0 ? 0 : 1);

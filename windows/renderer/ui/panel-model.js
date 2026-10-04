// panel-model.js — where every number comes from, what is assumed, how fast
// it runs, and who to cite.

import { h } from './dom.js';
import { t, num, int } from '../i18n.js';
import { panelHead, card, tag, kv, link } from './widgets.js';
import { LITERATURE } from '../../src/experiments.js';
import { MODEL_VERSION } from '../../src/provenance.js';
import { classifyRunTiming } from '../../src/performance.js';
import { getLanguage } from '../i18n.js';

export const modelPanel = {
  id: 'model', icon: 'model', title: 'Model', short: 'Model',
  build(ctx) {
    const d = ctx.data, p = d.provenance || {};
    const th = p.thermoExtension, se = p.sensoryExtension;
    const de = getLanguage() === 'de';
    // The fly that is running: FlyWire brain + MaleCNS cord, or one animal.
    const one = { male: { sym: '♂', set: 'MaleCNS v1.0' }, female: { sym: '♀', set: 'BANC v888' } }[p.flyModel];
    const shared = { descending: 0, ascending: 0 };
    const brainIds = new Set(d.circuit.neurons.map((n) => String(n.id)));
    for (const n of d.locomotor?.neurons ?? []) if (n.role in shared && brainIds.has(String(n.id))) shared[n.role]++;
    const specimenNotice = card(de ? 'Tierherkunft des laufenden Modells' : 'Specimens in the running model', { iconName: 'body' },
      one
        ? kv([[de ? 'Gehirn' : 'Brain', `${one.sym} ${one.set}`], [de ? 'Nervenstrang' : 'Nerve cord', `${one.sym} ${one.set}`],
          [de ? 'Verbindung' : 'Interface', de ? `Dieselben Zellen, Spike für Spike (${shared.descending} absteigend, ${shared.ascending} aufsteigend)`
            : `The same cells, spike by spike (${shared.descending} descending, ${shared.ascending} ascending)`]])
        : kv([[de ? 'Gehirn' : 'Brain', '♀ FAFB v783'], [de ? 'Nervenstrang' : 'Nerve cord', '♂ MaleCNS v1.0'],
          [de ? 'Verbindung' : 'Interface', de ? 'Tierübergreifendes Populationsmodell' : 'Cross-specimen population model']]),
      h('p', { class: 'note' }, one
        ? (de ? `Ein Tier: Gehirn und Nervenstrang desselben ${one.set}-Präparats. Der Körper ist modelliert. Die anderen Datenbestände lassen sich im Bereich Tiere anatomisch untersuchen.`
          : `One animal: brain and nerve cord of the same ${one.set} specimen. The body is modelled. Inspect the other datasets in Specimens.`)
        : (de ? 'Kein durchgehend zusammengehöriges Tier. Der Körper ist modelliert; ein biologisches Geschlecht des gesamten Laufs ist nicht belegt. BANC und MaleCNS lassen sich im Bereich Tiere getrennt anatomisch untersuchen.' : 'Not a single-specimen animal. The body is modelled; no biological sex is established for the combined run. Inspect BANC and MaleCNS separately in Specimens.')),
      one ? h('p', { class: 'note' }, t('Shared cell identities constrain the spike transfer; propagation is modelled. Unmatched ascending cells still receive population-rate feedback, and stepping rules use population rates.')) : null,
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.shell.select('specimens') }, de ? '♀ / ♂ Datenbestände öffnen' : 'Open female / male datasets'));
    const short = (x) => (x ? `${x.slice(0, 12)}…` : '—');
    const data = card(t('The data'), { iconName: 'data', tagEl: tag('measured') },
      kv([
        [t('Brain circuit ({source})', { source: one?.set ?? 'FlyWire FAFB v783' }), `${int(p.brainAudit?.neurons)} ${t('neurons')} · ${int(p.brainAudit?.edges)} ${t('connections')}`],
        [t('Thermosensory component'), th ? `${th.hotCells} + ${th.coldCells} ${t('sensors')}, ${th.relayNeurons} ${t('relays')}, ${int(th.addedEdges)} ${t('connections')}` : t('not loaded')],
        [t('Taste component'), se ? `${se.sugarCells} + ${se.bitterCells} ${t('taste neurons')}, ${se.proboscisMotorNeurons + se.ingestionMotorNeurons} ${t('motor neurons')}, ${se.tasteRelays} ${t('relays')}` : t('not loaded')],
        [t('Antennal grooming component'), se ? `${se.joFCells} JO-F, ${se.dng12} DNg12, ${se.groomingRelays} ${t('relays')}` : t('not loaded')],
        [t('Running brain'), `${int(d.circuit.neurons.length)} ${t('neurons')} · ${int(d.circuit.edges.length)} ${t('connections')}`],
        [t('Nerve cord ({source})', { source: one?.set ?? 'MaleCNS v1.0' }), `${int(d.locomotor?.neurons?.length)} ${t('neurons')} · ${int(d.locomotor?.edges?.length)} ${t('connections')}`],
        [t('Anatomical context'), `${int(d.points?.points?.length)} ${t('{source} somata', { source: one?.set.split(' ')[0] ?? 'FlyWire' })}`],
        ['circuit.json SHA-256', short(p.brainCircuitSHA256)],
        ['sensory_extension SHA-256', short(p.sensoryExtensionSHA256)],
      ]),
      h('p', { class: 'note' }, t('Anatomical endpoints and contact counts come from documented connectome extracts. Transmitter identity and sign use predictions; functional synaptic strength is modelled. Extensions are locked to their source files by SHA-256; mismatches are rejected.')),
      one ? h('p', { class: 'note' }, t('Sensory components are embedded in this native brain bundle and already included in its neuron count; they are not additional neurons beyond the base bundle.')) : null,
      d.circuit.frame ? h('p', { class: 'note' }, t('Display registration: {n} matched type/side pairs, RMS {rms} µm, fitted to the FAFB coordinate frame. A coordinate fit is not physiological validation or exact neuron correspondence.', {
        n: int(d.circuit.frame.matchedTypeSides), rms: num(d.circuit.frame.rmsMicrometres, 1) })) : null);

    const assumptions = card(t('What is measured, what is modelled'), { iconName: 'model' },
      h('div', { class: 'list' },
        h('div', {}, tag('measured'), ' ', t('which included neurons exist, where they sit, their annotated cell types, and their anatomical contact counts')),
        h('div', {}, tag('simulation'), ' ', t('every spike, rate, attribution and behavioural event reported by the running simulation')),
        h('div', {}, tag('model'), ' ', t('leaky integrate-and-fire dynamics at 1 ms, 20 ms membrane time constant, noise and tonic drive')),
        h('div', {}, tag('model'), ' ', t('Core base efficacy, sparse-pathway strength, recurrence and spike thresholds are specimen-specific model choices. The current values below are read from the simulation and saved in its manifest.')),
        h('div', {}, tag('model'), ' ', t('how light, sound, wind, heat, taste and dust are turned into receptor drive')),
        h('div', {}, tag('model'), ' ', t('early vision: motion energy in her rendered eye after a centre-surround stage, minus an efference copy of her own expected self-motion (Kim, Fitzgerald & Maimon 2015), drives the looming neurons')),
        h('div', {}, tag('model'), ' ', t('brain–nerve-cord coupling uses matching-cell spike transfer within a specimen or a population-rate interface across specimens; neither creates measured cross-specimen synapses')),
        h('div', {}, tag('model'), ' ', t('the body: legs, flight, grooming and feeding animation, health'))),
      h('p', { class: 'note' }, t('Everything tagged "model" is a stated assumption, written down in the code and the documentation, so it can be checked and changed.')));

    // Request compact run metadata once, not at display frequency. Showing the
    // actual constructed parameters avoids copying FlyWire's defaults onto
    // BANC/MaleCNS and also preserves any explicit experimental override.
    const parameterLabels = [
      'Core base efficacy', 'Pathway forward efficacy', 'Pathway recurrent fraction',
      'Giant-fiber thresholds', 'Arousal scale', 'Shared descending / ascending cells',
      'Unmatched ascending feedback targets', 'Stepping decoder',
    ];
    const parameterValues = parameterLabels.map(() => h('dd', {}, '—'));
    const parameterStatus = h('p', { class: 'note' }, t('Loading current run parameters…'));
    const neuralChoices = card(t('Current neural model choices'), { iconName: 'model', tagEl: tag('model') },
      h('dl', { class: 'kv' }, ...parameterLabels.flatMap((label, i) => [h('dt', {}, t(label)), parameterValues[i]])),
      parameterStatus,
      h('p', { class: 'note' }, t('Efficacies and thresholds use normalised membrane units, not measured millivolts. Scales and recurrence fractions are dimensionless. The stepping decoder is derived from the cord model, not measured physiology.')));
    let disposed = false;
    Promise.resolve().then(() => ctx.request('manifest')).then((manifest) => {
      if (disposed) return;
      const parameters = manifest?.model?.parameters, coupling = manifest?.model?.brainVncCoupling;
      if (!parameters || !coupling) throw new Error('Missing run metadata');
      const values = [
        Number.isFinite(parameters.coreWeightPerSynapse) && Number.isFinite(parameters.coreSynapseScale)
          ? num(parameters.coreWeightPerSynapse * parameters.coreSynapseScale, 6) : '—',
        num(parameters.pathwayWeightPerSynapse, 6), num(parameters.pathwayRecurrentFraction, 3),
        parameters.giantFiberThresholds?.map((value) => num(value, 3)).join(' / ') || '—',
        num(parameters.arousalScale, 3), `${int(coupling.sharedDescendingCells)} / ${int(coupling.sharedAscendingCells)}`,
        int(coupling.populationRateAscendingTargets),
        parameters.steppingRulesActive === null ? '—' : parameters.steppingRulesActive ? t('active') : t('inactive'),
      ];
      values.forEach((value, i) => { parameterValues[i].textContent = value; });
      parameterStatus.textContent = coupling.mode === 'shared-cell-spike-transfer'
        ? t('Same-specimen shared-cell spike transfer; unmatched ascending feedback remains modelled.')
        : coupling.mode === 'population-rate-interface'
          ? t('Cross-specimen population-rate coupling; no measured synapses between the two animals.')
          : t('The runtime coupling mode is recorded in the exported manifest.');
    }).catch(() => {
      if (!disposed) parameterStatus.textContent = t('Current run details could not be read. Unknown values stay unknown; export a manifest to inspect the run.');
    });

    const perfFields = [
      'Display', 'Requested speed', 'Simulation vs real time', 'Neural core speed',
      'Simulation thread load', 'Unsimulated time (this fly)', 'Unsimulated time (session)', 'Spikes per second',
      'Synaptic events per second', 'Render resolution',
    ];
    const perfValues = perfFields.map(() => h('dd', {}, '—'));
    const perfGrid = h('dl', { class: 'kv' },
      ...perfFields.flatMap((label, i) => [h('dt', {}, t(label)), perfValues[i]]));
    const timingStatus = h('p', { class: 'timing-status', role: 'status', 'aria-live': 'polite' });
    // Measured on the reference machine: 0.5x (and 0.25x) run without gaps
    // (VALIDATION.md, 30 September 2026). Offered only while a run lags.
    const slowerPace = h('button', { type: 'button', class: 'btn slower-pace', hidden: true,
      title: t('Measured without gaps on slower computers'), onclick: () => ctx.command('speed', { factor: 0.5 }) }, t('Run at 0.5×'));
    const perf = card(t('Performance'), { iconName: 'spark', tagEl: tag('measured') },
      timingStatus, slowerPace, perfGrid,
      h('p', { class: 'note' }, t('The live fly and experiments use separate worker threads; the display only draws. CPU cores are assigned by the operating system.')));

    const readiness = card(t('Research readiness'), { iconName: 'model', tagEl: tag('model') },
      h('p', { class: 'note' }, t('A measured wiring diagram constrains hypotheses; it does not by itself validate drug effects or establish subjective experience.')),
      h('div', { class: 'list' },
        h('div', {}, t('Now: run repeatable virtual interventions and export their seeds, model assumptions and timing gaps.')),
        h('div', {}, t('Next: fit receptor-specific physiology and neural dynamics to experimental recordings.')),
        h('div', {}, t('Then: test predictions prospectively against independent perturbation and behavioural data.')),
        h('div', {}, t('For drug studies: add measured target expression, exposure and dose-response data before claiming predictive validity.'))),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.shell.select('experiments') }, t('Open experiments')),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => ctx.shell.select('sentience') }, t('Open sentience evidence'))));

    const refs = card(t('References'), { iconName: 'data' },
      h('ul', { style: { margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.6 } },
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07558-y', 'Dorkenwald et al. (2024) Nature 634:124 — FlyWire whole-brain connectome')),
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07686-5', 'Schlegel et al. (2024) Nature 634:139 — FlyWire annotation and cell types')),
        h('li', {}, link('https://male-cns.janelia.org/download/', 'MaleCNS v1.0 — FlyEM at HHMI Janelia, University of Cambridge and collaborators')),
        h('li', {}, link('https://doi.org/10.7910/DVN/7WTH1N', 'BANC v888 — brain and nerve cord of one female specimen')),
        h('li', {}, link('https://doi.org/10.1038/s41586-024-07982-0', 'The fly connectome reveals a path to the effectome — causal dynamics need perturbation data')),
        h('li', {}, link('https://journals.biologists.com/jeb/article/224/21/jeb242740/272599/A-connectome-is-not-enough-what-is-still-needed-to', 'A connectome is not enough — receptor and physiological data remain essential')),
        ...Object.values(LITERATURE).map((l) => h('li', {}, link(l.doi, l.cite)))));

    const about = card(t('About'), {},
      kv([[t('Version'), MODEL_VERSION], [t('Code'), 'PolyForm Noncommercial 1.0.0'], [t('FlyWire data'), 'CC BY-NC 4.0'], [t('MaleCNS data'), 'CC BY 4.0'], [t('BANC data'), 'CC BY 4.0'], [t('Website'), 'neuro-cause.com']]),
      h('p', { class: 'note' }, t('Because the FlyWire data are licensed for non-commercial use, NeuroCause is free and carries no advertising.')),
      h('p', { class: 'note' }, t('Supporters of the lab may be invited to try pre-releases before they are public.'), ' ',
        link('https://neuro-cause.com/#support', t('Support NeuroCause'))));

    const el = h('div', {}, panelHead(t('Model'), t('Where every number comes from.'),
      t('The fly model is built on measured anatomy. This page separates what was measured from what was assumed.')),
    specimenNotice, perf, data, assumptions, neuralChoices, readiness, refs, about);

    return {
      el,
      dispose() { disposed = true; },
      update(snap) {
        const pr = snap.perf || {};
        const state = classifyRunTiming({ paused: snap.paused, speed: snap.speed, perf: pr });
        const messages = {
          paused: 'Paused — no simulation time is advancing.',
          gap: 'This fly has simulation gaps. Do not interpret missing time as biological inactivity; reduce speed for the next run.',
          measuring: 'Measuring simulation timing…',
          behind: 'Below requested speed. Compare results by simulated time, not wall-clock time.',
          'on-pace': 'Simulation is keeping pace with the requested speed.',
        };
        const message = t(messages[state]);
        if (timingStatus.dataset.state !== state) timingStatus.dataset.state = state;
        if (timingStatus.textContent !== message) timingStatus.textContent = message;
        const offerSlower = (state === 'gap' || state === 'behind') && (snap.speed ?? 1) > 0.5;
        if (slowerPace.hidden === offerSlower) slowerPace.hidden = !offerSlower;
        const values = [
          (ctx.displayStride ?? 1) > 1 ? `${num(ctx.fps ?? 0, 0)} fps · ${t('simulation first')}` : `${num(ctx.fps ?? 0, 0)} fps`,
          `${num(snap.speed ?? 1, 2)}×`,
          `${num(pr.simulationRealtime ?? 0, 2)}×`,
          `${num(pr.coreRealtime ?? 0, 1)}× ${t('real time')}`,
          `${Math.round((pr.loopLoad ?? 0) * 100)}%`,
          `${num(pr.runDroppedSimulationSeconds ?? 0, 3)} s`,
          `${num(pr.totalDroppedSimulationSeconds ?? 0, 3)} s`,
          int(pr.spikesPerSecond),
          int(pr.deliveriesPerSecond),
          `${num(ctx.pixelRatio ?? 1, 2)}×`,
        ];
        for (let i = 0; i < values.length; i++) {
          if (perfValues[i].textContent !== values[i]) perfValues[i].textContent = values[i];
        }
      },
    };
  },
};

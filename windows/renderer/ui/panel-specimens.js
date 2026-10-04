// Read-only specimen selection. These are native anatomical subgraphs, NOT a
// cosmetic sex switch for the existing cross-specimen terrarium simulation.
import { h } from './dom.js';
import { panelHead, card, kv, link } from './widgets.js';
import { getLanguage, int, num } from '../i18n.js';

export const specimensPanel = {
  id: 'specimens', icon: 'body', title: '♀ / ♂', short: '♀ / ♂',
  build(ctx) {
    const l = (de, en) => getLanguage() === 'de' ? de : en;
    const sexSymbol = sex => sex === 'female' ? '♀' : sex === 'male' ? '♂' : '?';
    let disposed = false, generation = 0, bundle = null, selected = -1, catalog = null;
    let incoming = [], outgoing = [], projection = [0, 1], morphology = null, cell = null;
    let cellGeneration = 0, pathGeneration = 0, pathReport = null, searchIndex = [], byId = new Map();
    const state = ctx.state.specimenExplorer ||= { id: 'banc-v888', query: '' };
    const status = h('p', { class: 'note', role: 'status', 'aria-live': 'polite', 'data-testid': 'specimen-status' }, l('Datenkatalog wird gelesen…', 'Reading data catalog…'));
    const choices = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
    const summary = h('div', { 'data-testid': 'specimen-summary' });
    const details = h('div', { 'data-testid': 'specimen-neuron' });
    const neighbors = h('div');
    const results = h('div', { class: 'list', 'data-testid': 'specimen-results' });
    const query = h('input', { type: 'search', placeholder: l('Zelltyp oder exakte Zell-ID', 'Cell type or exact cell ID'), 'aria-label': l('Neuron suchen', 'Find neuron'), 'data-testid': 'specimen-search', value: state.query, maxlength: 100, style: { width: '100%' } });
    const canvas = h('canvas', { width: 700, height: 380, style: { width: '100%', height: 'auto', background: '#08110e', borderRadius: '10px', cursor: 'crosshair' }, 'aria-label': l('Anatomische Projektion; Zellpunkte anklicken', 'Anatomical projection; click a neuron') });
    const morphCanvas = h('canvas', { width: 700, height: 350, style: { width: '100%', height: 'auto', background: '#08110e', borderRadius: '10px' } });
    const morphStatus = h('p', { class: 'note' });
    const morphCard = card(l('Rekonstruierte Zellform', 'Reconstructed cell morphology'), {}, morphStatus, morphCanvas);
    morphCard.hidden = true;
    const inventory = h('div', { 'data-testid': 'specimen-inventory' });
    const research = h('div', { 'data-testid': 'research-coverage' });
    let catalogBusy = false;
    const refreshArchive = h('button', { type: 'button', class: 'btn small', onclick: async () => {
      if (catalogBusy) return;
      catalogBusy = true; refreshArchive.disabled = true;
      try { const value = await ctx.api.getSpecimenCatalog(); if (!disposed) showResearch(value); }
      catch (error) { if (!disposed) status.textContent = error.message; }
      finally { catalogBusy = false; refreshArchive.disabled = false; }
    } }, l('Archivstatus aktualisieren', 'Refresh archive status'));
    function showResearch(value) {
      const a = value.archive, c = value.coverage;
      research.replaceChildren(h('p', { class: 'note' }, l('Download ≠ geprüfte Anatomie ≠ laufende Simulation ≠ validierter Tierversuchsersatz.', 'Download ≠ verified anatomy ≠ running simulation ≠ validated animal replacement.')));
      if (value.rawSources) {
        const r = value.rawSources;
        const rawCard = card(l('Lokale Rohdaten: Integritätsprüfung', 'Local raw data: integrity audit'), {},
          kv([[l('Prüfsummengleiche Dateien', 'Checksum-matching files'), int(r.verifiedFiles)],
            [l('Geprüfter Umfang', 'Verified size'), `${num(r.verifiedBytes / 1e9, 2)} GB`],
            [l('Momentaufnahme vom', 'Snapshot taken'), new Date(r.checkedAt).toLocaleString()]]),
          h('p', { class: 'note' }, l('SHA-256 gegen zuvor lokal gespeicherte Prüfsummen; keine unabhängige Bestätigung durch den Herausgeber. Dies ist eine Momentaufnahme, keine laufende Laufwerksprüfung. Rohdaten sind nicht automatisch in Anatomie oder Simulation importiert.',
            'SHA-256 against previously recorded local digests; not independent publisher authentication. This is a snapshot, not a live drive check. Raw data are not automatically imported into anatomy or simulation.')));
        rawCard.dataset.testid = 'raw-source-audit';
        const anatomyLabels = {
          'brain-and-nerve-cord': l('Gehirn und Nervenstrang', 'Brain and nerve cord'),
          'nerve-cord': l('Nervenstrang', 'Nerve cord'), 'partial-brain': l('Teil des Gehirns', 'Partial brain'),
          'right-optic-lobe': l('Rechter optischer Lobus', 'Right optic lobe'),
        };
        const fileLabels = {
          verified: l('Prüfsumme stimmt überein', 'Checksum matches'), missing: l('Datei fehlt', 'File missing'),
          'checksum-mismatch': l('Prüfsumme weicht ab', 'Checksum mismatch'), 'size-mismatch': l('Dateigrösse weicht ab', 'Size mismatch'),
          unreadable: l('Nicht lesbar', 'Unreadable'), 'unsafe-path': l('Unsicherer Dateipfad', 'Unsafe path'),
          'invalid-record': l('Ungültiger Eintrag', 'Invalid record'), 'changed-during-check': l('Während der Prüfung geändert', 'Changed during check'),
        };
        for (const d of r.datasets) {
          const details = h('details', {}, h('summary', {}, `${d.name} · ${d.sex === 'female' ? '♀' : '♂'} · ${int(d.verifiedFiles)}/${int(d.files.length)}`),
            h('p', { class: 'note' }, `${anatomyLabels[d.anatomy]} · ${d.status === 'verified' ? l('Dateiprüfung bestanden', 'File check passed') : l('Prüfung unvollständig oder fehlgeschlagen', 'Check incomplete or failed')}`));
          let built = false;
          details.addEventListener('toggle', () => {
            if (!details.open || built) return; built = true;
            details.append(...d.files.map(f => h('p', { class: 'note', style: { overflowWrap: 'anywhere' } }, `${f.name}: ${fileLabels[f.status]}`)),
              ...d.errors.map(e => h('p', { class: 'note', role: 'alert' }, `${l('Prüfproblem', 'Audit issue')}: ${e}`)));
          });
          rawCard.append(details);
        }
        research.append(rawCard);
      }
      if (a) {
        const unsafe = a.storageHealth?.status === 'untrusted';
        if (unsafe) research.append(h('p', { class: 'note', role: 'alert', style: { color: '#ffb17c' } },
          l('Archiv pausiert: Eine zuvor prüfsummengleiche Datei wurde später als Nullbytes gelesen. Historische Zählwerte sind nicht als gültige Forschungsdaten verwendbar; erneute Datenträgerprüfung und vollständige Prüfsummenprüfung nötig.',
            'Archive paused: a previously checksum-matching file later read back as zero bytes. Historical counts are not usable research data; storage diagnosis and full checksum re-verification are required.')));
        research.append(kv([[l('Archiv', 'Archive'), a.root], [unsafe ? l('Früher geprüfte Dateien (derzeit unverlässlich)', 'Previously verified files (currently untrusted)') : l('Geprüfte Dateien im Archivplan', 'Verified files in archive plan'), `${int(a.verifiedFiles)} / ${int(a.plannedFiles)}`],
          [l('Zuletzt erfasst', 'Last recorded'), new Date(a.checkedAt).toLocaleString()],
          [l('Archiviert', 'Archived'), `${num(a.verifiedBytes / 1e9, 2)} GB`], [l('Erfasster Plan', 'Catalogued plan'), `${num(a.totalPlannedBytes / 1e9, 2)} GB`]]),
          h('p', { class: 'note' }, l('Der Plan deckt ausgewählte Veröffentlichungen ab, nicht sämtliche weltweit verfügbaren Fliegendaten. Neue Rohdateien werden nicht automatisch in die laufende Fliege geladen.', 'The plan covers selected publications, not every fly dataset worldwide. New raw files do not automatically enter the running fly.')),
          ...a.datasets.map(d => h('p', {}, `${d.id}: ${int(d.verified)} / ${int(d.planned)} ${l('Dateien archiviert', 'files archived')}`)));
        const details = h('details', {}, h('summary', {}, l('Dateistatus anzeigen', 'Show file status')));
        let built = false;
        details.addEventListener('toggle', () => {
          if (!details.open || built) return; built = true;
          const labels = { verified: l('Geprüft archiviert', 'Verified archive'), downloading: l('Übertragung / Teilstand', 'Transfer / partial state'), failed: l('Fehlgeschlagen', 'Failed'), planned: l('Ausstehend', 'Pending') };
          details.append(...a.files.map(f => h('p', { class: 'note', style: { overflowWrap: 'anywhere' } }, `${labels[f.status] || f.status}: ${f.name}${f.error ? ' — ' + f.error : ''}`)));
        });
        research.append(details);
      }
      if (c) research.append(h('p', {}, `${l('Art', 'Species')}: ${c.species} · ${l('Prüfstand', 'Audit date')}: ${c.checkedAt}`),
        ...c.datasets.map(d => h('details', {}, h('summary', {}, d.name), kv([[l('Geschlecht', 'Sex'), d.sex], [l('Stadium', 'Stage'), d.stage], [l('Umfang', 'Anatomy'), d.anatomy], [l('Integration', 'Integration'), d.status]]),
          h('p', { class: 'note' }, d.missing), link(d.source, l('Originalquelle', 'Primary source')))),
        h('p', { class: 'note' }, l('Forschungsstatus: Noch kein validierter Ersatz für echte Fliegen oder Medikamentenversuche. Empfindungsfähigkeit ist ein Forschungsziel, kein gemessenes Ergebnis dieses Modells.', 'Research status: not yet a validated replacement for real flies or drug experiments. Sentience is a research goal, not a measured result of this model.')),
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.save('saveManifest', JSON.stringify({ schema: 'neurofly-research-coverage/1', coverage: c, archive: a, rawSources: value.rawSources, publicSources: value.publicSources, currentRuntime: value.currentRuntime }, null, 2)) }, l('Vollständigkeitsbericht exportieren', 'Export completeness report')));
      if (value.publicSources) research.append(h('details', {}, h('summary', {}, l('Weitere öffentliche Dateikataloge', 'Other public file catalogues')),
        ...value.publicSources.sources.map(s => h('p', { class: 'note' }, `${s.id}: ${s.status}${s.fileCount !== null ? ' · ' + int(s.fileCount) + ' ' + l('katalogisierte Dateien, nicht automatisch importiert', 'catalogued files, not automatically imported') : ''}${s.error ? ' · ' + s.error : ''}`))));
    }
    const content = h('div');
    const projectionSelect = h('select', { 'aria-label': l('Projektion', 'Projection'), onchange: e => {
      projection = e.target.value === 'xz' ? [0, 2] : [0, 1]; draw(); drawMorphology();
    } }, h('option', { value: 'xy' }, 'X / Y'), h('option', { value: 'xz' }, 'X / Z'));

    function point(n) {
      return [350 + n.pos[projection[0]] * 30, 190 - n.pos[projection[1]] * 16];
    }
    function draw() {
      const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height);
      if (!bundle) return;
      if (bundle.summary.annotatedRecordsWithPosition === 0) {
        g.fillStyle = '#a9cdbb'; g.font = '17px sans-serif';
        g.fillText(l('Keine veröffentlichten Zellkoordinaten in diesem Archiv.', 'No published cell coordinates in this archive.'), 22, 170);
        g.font = '14px sans-serif';
        g.fillText(l('Zell- und Pfadsuche funktionieren ohne erfundene Positionen.', 'Cell and path search work without invented positions.'), 22, 198);
        return;
      }
      for (let i = 0; i < bundle.neurons.length; i++) {
        const n = bundle.neurons[i];
        if (!n.pos) continue;
        const [x, y] = point(n);
        g.fillStyle = n.superClass.includes('motor') ? '#f0c66a' : n.superClass.includes('sensory') ? '#68bded' : '#24876b';
        g.fillRect(x, y, n.seed ? 2.5 : 1.6, n.seed ? 2.5 : 1.6);
      }
      if (selected < 0 || !bundle.neurons[selected].pos) return;
      const [x, y] = point(bundle.neurons[selected]);
      for (const [edges, color, endpoint] of [[incoming, '#8badff99', 0], [outgoing, '#4cff9a99', 1]]) {
        g.strokeStyle = color; g.lineWidth = 0.8;
        for (const e of edges.slice(0, 30)) {
          if (!bundle.neurons[e[endpoint]].pos) continue;
          const [px, py] = point(bundle.neurons[e[endpoint]]);
          g.beginPath(); g.moveTo(x, y); g.lineTo(px, py); g.stroke();
        }
      }
      g.fillStyle = '#edfff5'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b5c9c0'; g.font = '16px sans-serif';
      g.fillText(l('Punkte: Anatomie · Linien: Zellpaare, keine Axonverläufe', 'Points: anatomy · lines: cell pairs, not axon paths'), 12, 363);
    }
    function drawMorphology() {
      const g = morphCanvas.getContext('2d'); g.clearRect(0, 0, 700, 350);
      if (!morphology?.segments?.length) return;
      const [a, b] = projection;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const s of morphology.segments) for (const offset of [0, 3]) {
        minX = Math.min(minX, s[a + offset]); maxX = Math.max(maxX, s[a + offset]);
        minY = Math.min(minY, s[b + offset]); maxY = Math.max(maxY, s[b + offset]);
      }
      const scale = Math.min(640 / Math.max(1, maxX - minX), 290 / Math.max(1, maxY - minY));
      const x = value => 350 + (value - (minX + maxX) / 2) * scale;
      const y = value => 175 + (value - (minY + maxY) / 2) * scale;
      g.strokeStyle = '#44ee96'; g.lineWidth = 0.7; g.beginPath();
      for (const s of morphology.segments) { g.moveTo(x(s[a]), y(s[b])); g.lineTo(x(s[a + 3]), y(s[b + 3])); }
      g.stroke();
    }
    async function select(index) {
      if (!bundle || !Number.isInteger(index) || index < 0 || index >= bundle.neurons.length) return;
      selected = index;
      const token = generation, cellToken = ++cellGeneration;
      cell = null; incoming = []; outgoing = []; morphology = null; morphCard.hidden = true;
      exportButton.disabled = true;
      details.replaceChildren(h('p', { class: 'note' }, l('Zellbefund wird geladen…', 'Loading cell details…')));
      neighbors.replaceChildren(); draw();
      try {
      const result = await ctx.api.getSpecimenCell(bundle.profile.id, bundle.neurons[index].id, bundle.sha256);
      if (disposed || token !== generation || cellToken !== cellGeneration) return;
      cell = result.neuron; incoming = result.incoming; outgoing = result.outgoing;
      exportButton.disabled = false;
      const n = cell;
      const ins = incoming, outs = outgoing;
      const reviewed = n.annotations?.reviewedCorrespondences || [];
      const kept = ins.reduce((sum, e) => sum + e[2], 0);
      details.replaceChildren(kv([
        [l('Tier', 'Specimen'), `${sexSymbol(bundle.profile.sex)} ${bundle.profile.name}`],
        ['ID', n.id], [l('Zelltyp', 'Cell type'), n.type], [l('Klasse / Seite', 'Class / side'), `${n.superClass} · ${n.side}`],
        [l('Position verfügbar', 'Position available'), n.pos ? l('Ja', 'Yes') : l('Nein — Zelle bleibt im Netzwerk', 'No — cell retained in network')],
        [l('Transmitter', 'Transmitter'), `${n.nt} (${n.ntEvidence})`],
        [l('Score der Transmittervorhersage', 'Transmitter prediction score'), n.ntEvidence !== 'predicted' || n.ntConfidence === null ? '—' : num(n.ntConfidence, 3)],
        [l('Eingehende Kontakte im Ausschnitt', 'Input contacts in subset'), int(kept)],
        [l('Eingehende Kontakte in der Quelle', 'Input contacts in source'), int(n.fullInputContacts)],
        [l('Erhaltener Eingang', 'Retained input'), n.fullInputContacts ? `${num(100 * kept / n.fullInputContacts, 1)}%` : '—'],
      ]), ...(reviewed.length ? [h('details', {}, h('summary', {}, l(`Manuell geprüfte Korrespondenzen (${reviewed.length})`, `Human-reviewed correspondences (${reviewed.length})`)),
        h('p', { class: 'note' }, l('Vergleichshinweise zwischen Präparaten, keine Synapsen zwischen Tieren und keine identische biologische Zelle. Versionen der Ziel-IDs müssen separat geprüft werden.', 'Comparative links between specimens, not synapses between animals or the same biological cell. Target ID releases require separate verification.')),
        ...reviewed.map(m => h('p', { class: 'note' }, `${m.targetSpecimen} · ${m.targetId}${m.targetType ? ' · ' + m.targetType : ''}${m.relation === 'within-specimen-mirror' ? l(' · Spiegelpartner', ' · mirror partner') : ''}`)))] : []),
      h('details', {}, h('summary', {}, l('Original-Annotationen', 'Original annotations')),
        h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '10px' } }, JSON.stringify(n.annotations, null, 2))));
      const rows = (edges, endpoint) => edges.slice(0, 8).map(e => {
        const neighbor = bundle.neurons[e[endpoint]];
        return h('button', { class: 'btn small', type: 'button', style: { width: '100%', justifyContent: 'space-between', marginBottom: '4px' }, onclick: () => select(e[endpoint]), title: neighbor.id }, neighbor.type, h('span', {}, `${int(e[2])} ${l('Kontakte', 'contacts')}`));
      });
      neighbors.replaceChildren(h('h4', {}, l('Stärkste Eingänge', 'Strongest inputs')), ...rows(ins, 0), h('h4', {}, l('Stärkste Ausgänge', 'Strongest outputs')), ...rows(outs, 1));
      draw();
      {
        ctx.api.getSpecimenMorphology(n.id, bundle.profile.id).then(value => {
          if (disposed || token !== generation || cellToken !== cellGeneration) return;
          morphology = value; morphCard.hidden = !value;
          if (!value) return;
          morphStatus.textContent = `${value.specimen} · ${value.resolution || 'LOD1'} · ${int(value.points)} ${l('SWC-Punkte', 'SWC points')} · ${num(value.cableLengthNm / 1000, 1)} µm ${l('Skelettlänge', 'skeleton length')} · ${int(value.branchPoints)} ${l('Verzweigungen', 'branch points')}${value.truncated ? l(' · Anzeige gekürzt', ' · display truncated') : ''}`;
          drawMorphology();
        }).catch(error => { if (!disposed && token === generation && cellToken === cellGeneration) morphStatus.textContent = error.message; });
      }
      } catch (error) { if (!disposed && token === generation && cellToken === cellGeneration) details.textContent = error.message; }
    }
    function search() {
      state.query = query.value;
      if (!bundle) return;
      const q = query.value.trim().toLowerCase();
      if (!q) { results.replaceChildren(); return; }
      const exact = byId.get(q) ?? -1;
      const matches = exact >= 0 ? [exact] : searchIndex.map((text, i) => text.includes(q) ? i : -1).filter(i => i >= 0);
      results.replaceChildren(...matches.slice(0, 12).map(i => h('button', { type: 'button', class: 'btn small', style: { width: '100%', justifyContent: 'space-between' }, onclick: () => select(i) }, bundle.neurons[i].type, h('small', {}, bundle.neurons[i].id))),
        h('p', { class: 'note' }, matches.length ? l(`${matches.length} Treffer im geladenen Ausschnitt.`, `${matches.length} matches in the loaded subset.`) : l('Nicht im Ausschnitt. Das bedeutet nicht, dass die Zelle im Tier fehlt.', 'Not in this subset. This does not establish absence in the animal.')));
      if (exact >= 0) select(exact);
    }
    query.addEventListener('input', search);
    canvas.addEventListener('click', event => {
      if (!bundle) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * 700 / rect.width, y = (event.clientY - rect.top) * 380 / rect.height;
      let best = -1, distance = 225;
      bundle.neurons.forEach((n, i) => { if (!n.pos) return; const [px, py] = point(n); const d = (px - x) ** 2 + (py - y) ** 2; if (d < distance) { best = i; distance = d; } });
      if (best >= 0) select(best);
    });
    async function load(id) {
      if (bundle?.profile.id === id) return;
      const token = ++generation;
      state.id = id; bundle = null; selected = -1; morphology = null; cell = null;
      incoming = []; outgoing = []; searchIndex = []; byId.clear(); exportButton.disabled = true;
      pathGeneration++; pathReport = null; pathResult.replaceChildren(); pathExport.disabled = true;
      pathFrom.value = ''; pathTo.value = ''; pathButton.disabled = true;
      summary.replaceChildren(); details.replaceChildren(); neighbors.replaceChildren(); results.replaceChildren(); morphCard.hidden = true; draw();
      for (const button of choices.children) button.setAttribute('aria-pressed', String(button.dataset.specimen === id));
      status.textContent = l('Anatomie wird geprüft und geladen…', 'Verifying and loading anatomy…');
      try {
        const data = await ctx.api.getSpecimenData(id);
        if (disposed || token !== generation) return;
        bundle = data;
        projectionSelect.disabled = data.summary.annotatedRecordsWithPosition === 0;
        pathMin.min = String(data.summary.edgeThreshold);
        pathMin.value = String(data.summary.edgeThreshold);
        searchIndex = data.neurons.map(n => `${n.type} ${n.aliases} ${n.superClass} ${n.id}`.toLowerCase());
        byId = new Map(data.neurons.map((n, i) => [n.id, i]));
        pathButton.disabled = false;
        summary.replaceChildren(kv([
          [l('Datensatz', 'Dataset'), data.profile.name],
          [l('Zellen im Ausschnitt', 'Cells in subset'), int(data.neurons.length)],
          [l('Davon ohne Positionsangabe', 'Without position data'), int(data.summary.unlocatedSelected ?? 0)],
          [l('Gerichtete Zellpaare', 'Directed cell pairs'), int(data.edgeCount)],
          [l('Synaptische Kontakte', 'Synaptic contacts'), int(data.summary.selectedContacts)],
          [l('Mindestzahl Kontakte pro Paar', 'Minimum contacts per pair'), int(data.summary.edgeThreshold)],
          ...(data.summary.selectedMorphometricRows ? [[l('Regionale Morphometrie-Zeilen', 'Regional morphometry rows'), int(data.summary.selectedMorphometricRows)]] : []),
          ...(data.summary.selectedReviewedCorrespondences ? [[l('Geprüfte Korrespondenzen', 'Reviewed correspondences'), int(data.summary.selectedReviewedCorrespondences)]] : []),
          ...(data.summary.reviewedRowsWithoutExactTargetId ? [[l('Quellzeilen ohne exakte Ziel-ID', 'Source rows without exact target ID'), int(data.summary.reviewedRowsWithoutExactTargetId)]] : []),
          [l('Koordinaten', 'Coordinates'), data.profile.id === 'l1em-winding-2023'
            ? l('Keine Zellkoordinaten im Quellenanhang', 'No cell coordinates in source archive') : data.coordinateSpace],
          ...(data.profile.sourceRelease ? [[l('Quellversion', 'Source release'), data.profile.id === 'hemibrain-v1.2'
            ? l('Verbindungen v1.2 · Positionen v1.2.1', 'Connections v1.2 · positions v1.2.1') : data.profile.sourceRelease]] : []),
          ...(data.summary.sameSampleIdOverlapVerified ? [[l('Mit MaleCNS abgeglichene IDs', 'IDs cross-checked with MaleCNS'), int(data.summary.sameSampleIdOverlapVerified)]] : []),
          ['SHA-256', h('span', { title: data.sha256 }, `${data.sha256.slice(0, 16)}…`)],
        ]), h('p', { class: 'note' }, data.profile.id === 'l1em-winding-2023'
          ? l('Larvales Gehirn als nicht-räumlicher Graph: 2.952 Zellen aus dem all-all-Matrixanhang, ohne publizierte Zellkoordinaten oder Transmitter in dieser Datei. Die Teilmatrizen werden nicht addiert. Kein erwachsenes Tier, keine laufende Simulation.', 'Larval brain as a non-spatial graph: 2,952 cells from the all-all matrix supplement, without cell coordinates or transmitters in this archive. Compartment matrices are not added. Not an adult animal or a running simulation.')
          : data.profile.id === 'hemibrain-v1.2'
          ? l('Teil eines eigenständigen weiblichen Gehirns: v1.2-Verbindungen und vorhergesagte Transmitter. Soma-Positionen stammen aus ergänzenden v1.2.1-Metadaten und wurden nur über exakte Zell-IDs zugeordnet. Kein vollständiges Tier und keine laufende Simulation.', 'Part of a separate female brain: v1.2 connections and predicted transmitters. Soma positions come from v1.2.1 supplementary metadata joined only by exact cell IDs. Not a complete animal or a running simulation.')
          : data.profile.id === 'optic-lobe-v1.1'
          ? l('Eine lokalisierte Zelle je benanntem Typ, dann Zellen mit hohem Quell-Synapsengewicht. Dasselbe männliche Präparat wie MaleCNS, aber eine andere Version: Überlappende Verbindungen werden nicht addiert. Keine laufende Simulation.', 'One located cell per named type, then cells with high source synaptic weight. Same male specimen as MaleCNS, but another release: overlapping connections are not added. Not a running simulation.')
          : l('Auswahl: motorische und absteigende Zellen, benannte Steuerzellen und starke Verbindungspartner. Maximal 6.000 Zellen; kein vollständiges Nervensystem.', 'Selection: motor, descending and named command cells with strong partners. Up to 6,000 cells; not a complete nervous system.')));
        status.textContent = l('Geprüfte Anatomie geladen · Terrarium unverändert.', 'Verified anatomy loaded · terrarium unchanged.');
        select(Math.max(0, data.neurons.findIndex(n => n.type === 'DNp01'))); search();
      } catch (error) { if (!disposed && token === generation) status.textContent = `${l('Nicht geladen', 'Not loaded')}: ${error.message}`; }
    }
    const exportButton = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => {
      if (!bundle || selected < 0 || !cell) return;
      const record = { schema: 'neurofly-anatomical-observation/1', profile: bundle.profile, bundleSHA256: bundle.sha256,
        neuron: cell, input: incoming.map(e => ({ id: bundle.neurons[e[0]].id, contacts: e[2] })),
        output: outgoing.map(e => ({ id: bundle.neurons[e[1]].id, contacts: e[2] })),
        sources: bundle.sources, scope: 'Anatomical subset; no neural activity or sentience inferred' };
      ctx.save('saveManifest', JSON.stringify(record, null, 2));
    } }, l('Zellbefund exportieren', 'Export cell observation'));
    const pathFrom = h('input', { type: 'text', inputmode: 'numeric', maxlength: 24, 'aria-label': l('Start-Zell-ID', 'Source neuron ID'), 'data-testid': 'path-from', placeholder: l('Start: exakte Zell-ID', 'Source: exact neuron ID'), style: { width: '100%' } });
    const pathTo = h('input', { type: 'text', inputmode: 'numeric', maxlength: 24, 'aria-label': l('Ziel-Zell-ID', 'Target neuron ID'), 'data-testid': 'path-to', placeholder: l('Ziel: exakte Zell-ID', 'Target: exact neuron ID'), style: { width: '100%' } });
    const pathMin = h('input', { type: 'number', min: 5, step: 1, value: 5, 'aria-label': l('Mindestkontakte', 'Minimum contacts'), style: { width: '72px' } });
    const pathHops = h('input', { type: 'number', min: 1, max: 12, step: 1, value: 6, 'aria-label': l('Maximale Schritte', 'Maximum hops'), style: { width: '60px' } });
    const pathResult = h('div', { role: 'status', 'aria-live': 'polite', 'data-testid': 'path-result' });
    const pathExport = h('button', { type: 'button', class: 'btn small', disabled: true, onclick: () => {
      if (pathReport) ctx.save('saveManifest', JSON.stringify(pathReport, null, 2));
    } }, l('Pfadbefund exportieren', 'Export path observation'));
    const pathButton = h('button', { type: 'button', class: 'btn', disabled: true, 'data-testid': 'path-find', onclick: async () => {
      if (!bundle) return;
      const token = generation, pathToken = ++pathGeneration;
      pathReport = null; pathExport.disabled = true; pathButton.disabled = true;
      pathResult.textContent = l('Gerichtete Verbindungen werden durchsucht…', 'Searching directed connections…');
      try {
        const report = await ctx.api.getSpecimenPath(bundle.profile.id, { from: pathFrom.value.trim(), to: pathTo.value.trim(), minContacts: Number(pathMin.value), maxHops: Number(pathHops.value) }, bundle.sha256);
        if (disposed || token !== generation || pathToken !== pathGeneration) return;
        pathReport = report; pathExport.disabled = false;
        const pathCount = `${report.shortestPathCountCapped ? '≥ ' : ''}${int(report.shortestPathCount)}`;
        pathResult.replaceChildren(h('p', { class: 'note' }, report.found
          ? l(`${report.hops} gerichtete Schritte · ${pathCount} gleich kurze Wege im Ausschnitt (einer gezeigt).`, `${report.hops} directed hops · ${pathCount} equally short paths in the subset (one shown).`)
          : l('Kein Pfad unter diesen Grenzen im Ausschnitt gefunden. Keine Aussage über das vollständige Tier.', 'No path within these bounds in the subset. This does not establish absence in the complete animal.')),
          ...report.neurons.flatMap((n, i) => [h('button', { class: 'btn small', type: 'button', style: { width: '100%', marginBottom: '4px', justifyContent: 'space-between' }, onclick: () => select(byId.get(n.id)) }, n.type, h('small', {}, n.id)),
            ...(i < report.edges.length ? [h('p', { class: 'note' }, `↓ ${int(report.edges[i].contacts)} ${l('rekonstruierte Kontakte', 'reconstructed contacts')}`)] : [])]));
      } catch (error) { if (!disposed && token === generation && pathToken === pathGeneration) pathResult.textContent = error.message; }
      finally { if (!disposed && token === generation && pathToken === pathGeneration) pathButton.disabled = false; }
    } }, l('Verbindungsweg finden', 'Find connection path'));
    const pathCard = card(l('Native Verbindungswege', 'Native connection paths'), {},
      h('p', { class: 'note' }, l('Nur Verbindungen desselben Tiers. Kontaktzahlen sind keine Übertragungswahrscheinlichkeiten; ein anatomischer Pfad beweist keine funktionelle Wirkung.', 'Only connections from the same specimen. Contact counts are not transmission probabilities; an anatomical path does not establish functional influence.')),
      pathFrom, h('button', { type: 'button', class: 'btn small', onclick: () => { if (bundle && selected >= 0) pathFrom.value = bundle.neurons[selected].id; } }, l('Auswahl als Start', 'Selection as source')),
      pathTo, h('button', { type: 'button', class: 'btn small', onclick: () => { if (bundle && selected >= 0) pathTo.value = bundle.neurons[selected].id; } }, l('Auswahl als Ziel', 'Selection as target')),
      h('div', { class: 'row', style: { flexWrap: 'wrap', margin: '10px 0' } }, h('label', {}, l('Kontakte ≥ ', 'Contacts ≥ '), pathMin), h('label', {}, l('Schritte ≤ ', 'Hops ≤ '), pathHops)),
      pathButton, pathResult, pathExport);
    // Which fly runs in the terrarium: the original mixed model, or brain and
    // nerve cord of one male animal (data/male, etl_malecns_brain.py).
    function runningFlyCard() {
      const current = ctx.data?.provenance?.flyModel || 'mixed';
      const options = [
        { id: 'mixed', title: l('♀ Gehirn + ♂ Nervenstrang', '♀ brain + ♂ nerve cord'),
          text: l('FlyWire-FAFB-Gehirn (Weibchen) und MaleCNS-Nervenstrang (Männchen), über eine modellierte Schnittstelle gekoppelt. Mit allen Sinnen: Wärme, Geschmack, Staub auf den Antennen.',
            'FlyWire FAFB brain (female) and MaleCNS nerve cord (male), joined by a modelled interface. With every sense: heat, taste, dust on the antennae.') },
        { id: 'male', title: l('♂ Ein Männchen, ein Tier', '♂ One male, one animal'),
          text: l('Gehirn und Nervenstrang desselben MaleCNS-Tiers. Die 16 absteigenden und 34 aufsteigenden Zellen, die beide teilen, geben ihre Spikes Zelle für Zelle weiter. Mit seinen eigenen Wärme-, Geschmacks- und Putzbahnen.',
            'Brain and nerve cord of the same MaleCNS animal. The 16 descending and 34 ascending cells both share pass their spikes on cell by cell. With his own heat, taste and grooming pathways.') },
        { id: 'female', title: l('♀ Ein Weibchen, ein Tier', '♀ One female, one animal'),
          text: l('Gehirn und Nervenstrang desselben BANC-Tiers. Die 15 absteigenden und 18 aufsteigenden Zellen, die beide teilen, geben ihre Spikes Zelle für Zelle weiter. Mit ihren eigenen Wärme-, Geschmacks- und Putzbahnen.',
            'Brain and nerve cord of the same BANC animal. The 15 descending and 18 ascending cells both share pass their spikes on cell by cell. With her own heat, taste and grooming pathways.') },
      ];
      const note = h('p', { class: 'note', role: 'status' });
      const buttons = h('div', { class: 'fly-models' });
      const render = (available) => buttons.replaceChildren(...options.map((o) => {
        const ready = available.includes(o.id), on = o.id === current;
        return h('button', { type: 'button', class: `fly-model${on ? ' on' : ''}`, 'aria-pressed': String(on), 'data-fly-model': o.id, disabled: !ready || on,
          onclick: async () => {
            note.textContent = l('Die Simulation startet mit der gewählten Fliege neu…', 'Restarting the simulation with the chosen fly…');
            const ok = await ctx.api.setFlyModel?.(o.id);
            if (!ok) note.textContent = l('Dieses Modell ist nicht installiert.', 'This model is not installed.');
          } }, h('b', {}, o.title), h('span', {}, o.text), on ? h('em', {}, l('läuft', 'running')) : null);
      }));
      render([current]);
      ctx.api.getFlyModels?.().then((m) => { if (!disposed) render(m.available); }).catch(() => {});
      return card(l('Laufende Fliege', 'Running fly'), {}, buttons,
        h('p', { class: 'note' }, l('Jedes Modell: Verdrahtung gemessen, Dynamik, Sinne und Körper modelliert. Die Anatomie unten ist davon unabhängig.',
          'Every model: wiring measured; dynamics, senses and body modelled. The anatomy below is independent of this choice.')), note);
    }
    const el = h('div', { class: 'specimen-panel' }, panelHead(l('Tiere & Daten', 'Specimens & data'), l('Zwei Geschlechter. Getrennte Quellen.', 'Two sexes. Separate sources.'),
      l('♀ BANC und ♂ MaleCNS besitzen jeweils Gehirn und Nervenstrang desselben Tiers. Die männliche Optiklappe ist eine überlappende Version desselben MaleCNS-Präparats. MANC, FAFB und Hemibrain sind unabhängige erwachsene Tiere; L1EM ist eine Larve.', 'Female BANC and male MaleCNS each contain brain and nerve cord from one specimen. The male optic lobe is an overlapping release of the same MaleCNS specimen. MANC, FAFB and Hemibrain are separate adults; L1EM is a larva.')),
      runningFlyCard(),
      choices, status, content, card(l('Forschungsbestand & Lücken', 'Research coverage & gaps'), {}, refreshArchive, research), card(l('Import-Checkliste', 'Import checklist'), {}, inventory));
    content.append(card(l('Datenbestand', 'Dataset'), {}, summary), card(l('Anatomie untersuchen', 'Inspect anatomy'), {}, projectionSelect, canvas,
      h('p', { class: 'note' }, l('Blau: Eingänge · Grün: Ausgänge · jeweils höchstens 30 gezeichnet. Keine Aktivitätsanzeige. Positionen sind Referenzpunkte, nicht durchgehend Zellkörper.', 'Blue: inputs · green: outputs · up to 30 drawn each. Not an activity display. Positions are reference points, not uniformly somata.')), query, results),
      card(l('Ausgewählte Zelle', 'Selected cell'), {}, details, exportButton, neighbors), morphCard, pathCard);
    ctx.api.getSpecimenCatalog().then(value => {
      if (disposed) return;
      catalog = value;
      showResearch(value);
      choices.replaceChildren(...value.profiles.map(p => h('button', { type: 'button', class: 'btn', 'data-specimen': p.id, 'data-testid': `choose-${p.id}`, 'aria-pressed': 'false', disabled: p.status !== 'anatomy-ready',
        title: p.status === 'anatomy-ready' ? p.name : l('Noch nicht importiert', 'Not yet imported'), onclick: () => load(p.id) }, `${sexSymbol(p.sex)} ${p.name}`)));
      inventory.replaceChildren(h('p', { class: 'note' }, `${l('Stand', 'Checked')}: ${value.checkedAt ? new Date(value.checkedAt).toLocaleString() : '—'}`),
        ...value.profiles.map(p => h('p', {}, `${sexSymbol(p.sex)} `, link(p.source, p.name), ` · ${p.status === 'anatomy-ready' ? l('Anatomie integriert', 'Anatomy integrated') : l('Import offen', 'Import pending')} · ${p.license}`)),
        ...value.files.map(f => h('details', {}, h('summary', {}, `${f.status === 'verified' ? '✓' : '⚠'} ${f.name}`),
          kv([[l('Quelle', 'Source'), f.dataset], [l('Größe', 'Size'), `${num(f.bytes / 1024 ** 2, 1)} MiB`], ['SHA-256', f.sha256 || '—'], [l('Prüfung', 'Check'), f.error || l('Kopie und Prüfsumme erfasst', 'Copy and checksum recorded')]]))),
        h('p', { class: 'note' }, l('Prüfsummen sichern Dateiidentität, nicht biologische Vollständigkeit. Alternative Synapsendetektoren bleiben getrennt. Anatomische Daten belegen kein subjektives Erleben.', 'Checksums establish file identity, not biological completeness. Alternative synapse detections remain separate. Anatomical data do not establish subjective experience.')));
      const initial = value.profiles.find(p => p.id === state.id && p.status === 'anatomy-ready') || value.profiles.find(p => p.status === 'anatomy-ready');
      if (initial) load(initial.id); else status.textContent = l('Noch keine geprüften Anatomiepakete verfügbar.', 'No verified anatomical bundles available yet.');
    }).catch(error => { if (!disposed) status.textContent = error.message; });
    return { el, dispose() { disposed = true; generation++; pathGeneration++; cellGeneration++; bundle = null; cell = null; morphology = null; incoming = []; outgoing = []; searchIndex = []; byId.clear(); catalog = null; pathReport = null; } };
  },
};

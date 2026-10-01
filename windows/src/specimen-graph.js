// Anatomical queries only: positive contact counts are not physiological gains.
export function indexSpecimen(bundle) {
  const incoming = Array.from({ length: bundle.neurons.length }, () => []);
  const outgoing = Array.from({ length: bundle.neurons.length }, () => []);
  for (const e of bundle.edges) { incoming[e[1]].push(e); outgoing[e[0]].push(e); }
  const order = (a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1];
  for (let i = 0; i < incoming.length; i++) {
    incoming[i].sort(order);
    outgoing[i].sort(order);
  }
  return { incoming, outgoing, byId: new Map(bundle.neurons.map((n, i) => [n.id, i])) };
}

export function findSpecimenPath(bundle, index, options = {}) {
  const { from, to, minContacts = 5, maxHops = 6 } = options;
  if (typeof from !== 'string' || typeof to !== 'string' || !/^\d{1,24}$/.test(from) || !/^\d{1,24}$/.test(to)) throw new Error('Use exact decimal neuron IDs');
  if (!Number.isSafeInteger(minContacts) || minContacts < (bundle.summary?.edgeThreshold ?? 5)
    || !Number.isInteger(maxHops) || maxHops < 1 || maxHops > 12) throw new Error('Invalid path threshold or hop limit (1–12)');
  const start = index.byId.get(from), goal = index.byId.get(to);
  if (start === undefined || goal === undefined) throw new Error('Neuron is not in this specimen subset');
  const report = { schema: 'neurofly-anatomical-path/1', profile: bundle.profile, bundleSHA256: bundle.sha256,
    sources: bundle.sources, query: { from, to, minContacts, maxHops }, found: false, neurons: [], edges: [],
    shortestPathCount: 0, shortestPathCountCapped: false,
    scope: 'One representative directed shortest-hop path and the count of equally short paths within this anatomical subset and threshold; neither establishes functional transmission or sentience. Absence does not establish absence in the animal.' };
  const parent = new Int32Array(bundle.neurons.length).fill(-1), depth = new Uint8Array(bundle.neurons.length);
  const via = new Float64Array(bundle.neurons.length), queue = new Uint32Array(bundle.neurons.length);
  const counts = new Float64Array(bundle.neurons.length), capped = new Uint8Array(bundle.neurons.length);
  const countLimit = 1_000_000_000;
  let head = 0, tail = 0;
  parent[start] = start; counts[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const node = queue[head++];
    // Once the goal is discovered, finish only the preceding BFS layer so
    // every equally short route is counted without traversing deeper layers.
    if (depth[node] >= maxHops || (parent[goal] >= 0 && depth[node] >= depth[goal])) break;
    for (const edge of index.outgoing[node]) {
      if (edge[2] < minContacts) break; // descending contact order
      const next = edge[1];
      const nextDepth = depth[node] + 1;
      if (parent[next] < 0) {
        parent[next] = node; via[next] = edge[2]; depth[next] = nextDepth;
        counts[next] = counts[node]; capped[next] = capped[node];
        queue[tail++] = next;
      } else if (depth[next] === nextDepth) {
        const sum = counts[next] + counts[node];
        capped[next] ||= capped[node] || sum > countLimit ? 1 : 0;
        counts[next] = Math.min(sum, countLimit);
      }
    }
  }
  report.visitedNeurons = tail;
  if (parent[goal] < 0) return report;
  report.shortestPathCount = counts[goal];
  report.shortestPathCountCapped = Boolean(capped[goal]);
  const steps = [goal];
  while (steps.at(-1) !== start) steps.push(parent[steps.at(-1)]);
  steps.reverse(); report.found = true; report.hops = steps.length - 1;
  report.neurons = steps.map(i => { const n = bundle.neurons[i]; return { id: n.id, type: n.type, specimen: n.specimen, nt: n.nt, ntEvidence: n.ntEvidence }; });
  report.edges = steps.slice(1).map(i => ({ from: bundle.neurons[parent[i]].id, to: bundle.neurons[i].id, contacts: via[i] }));
  return report;
}

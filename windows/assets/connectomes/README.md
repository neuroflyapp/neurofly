# NeuroCause specimen anatomy bundles

These generated files are **read-only anatomical subgraphs**, not certified live
animal models. Selecting a specimen does not replace the terrarium simulation.

- `banc-v888.json`: female BANC, materialization 888. Source graph v3 and metadata
  from [Bates et al., final data release](https://doi.org/10.7910/DVN/7WTH1N),
  CC BY 4.0. Crucially, joins use `banc_888_id`, not the older `root_id` column.
  The selected cells also retain publisher morphometric rows by v888 ID and
  region (cable length in µm, volume in nm³). Region rows are never summed
  into a false whole-cell measurement or interpreted as physiology.
  Six small publisher-MD5-verified, human-reviewed correspondence tables add
  comparative labels to selected BANC v888 cells. The join key is the
  publisher-documented `pt_root_id`, **not** `query_id`; the within-BANC mirror
  target uses `match_root_id`. Valid review rows alone are retained. These
  labels never connect independent specimens electrically, and destination
  release identities are not assumed. Even rows marked valid can carry `NA`
  or free-text target IDs; these are counted separately and not presented as
  exact neuron links. Dataverse serves these `.csv.gz` files
  as plain CSV bytes; the importer checks the recorded encoding.
- `malecns-v1.json`: male MaleCNS v1.0, annotation/NT/connection tables from
  [FlyEM, Janelia and collaborators](https://male-cns.janelia.org/download/),
  CC BY 4.0. Native 8-nm coordinates are converted to nanometres.
- `manc-v1.0.json`: male MANC v1.0 nerve-cord anatomy subset from
  [FlyEM/Janelia](https://www.janelia.org/project-team/flyem/manc-connectome),
  CC BY 4.0. It contains a different individual from MaleCNS. The importer
  checks source sizes and local SHA-256 records, uses only the total adjacency
  CSV (never adds per-ROI rows or its duplicate), and retains predicted
  transmitter labels as predictions. This explorer is not a running circuit.
- `optic-lobe-v1.1.json`: 6,000 located, traced right-optic-lobe cells from
  [FlyEM/Janelia](https://www.janelia.org/node/69305), CC BY 4.0. One cell
  per named type is retained, then cells are ranked by published synaptic
  weight. All 6,000 selected IDs occur in the MaleCNS v1.0 annotation table:
  this is an overlapping release of the *same* male CNS sample, not another
  animal. Versioned edges are never added to the MaleCNS graph. Two locally
  checksum-checked files are used; the alternate primary-only edge export is
  not added. This explorer is not a running circuit.
- `hemibrain-v1.2.json`: independent female partial-brain explorer. The
  published v1.2 traced-neuron/total-adjacency archive and v1.2 body-mean
  transmitter predictions supply the circuit; the v1.2.1 supplementary
  annotation table supplies *only exact-body-ID-matched* soma positions and
  cell-class detail. Neither the per-ROI rows nor another release's edges are
  added to the total adjacency. The different minor releases are labelled in
  the bundle. The supplementary repository does not publish an explicit data
  license; review before public redistribution. No live runtime claims.
  Kept out of public snapshots and release builds until its terms are
  confirmed (`.gitattributes`, `build-portable.ps1`); the app then lists it
  as not imported.
- `l1em-winding-2023.json`: the 2,952-cell `all-all` directed matrix from
  Winding et al. 2023 Supplementary Data S1, archived through a pinned Git
  mirror. All 110,677 nonzero pairs and 352,611 contacts are retained.
  Axon/dendrite compartment matrices remain in the small raw ZIP and are not
  added to the total. No cell coordinates or transmitter assignments are in
  that archive: the graph is deliberately non-spatial and every position is
  marked missing. The archived matrix is not the paper's whole animal, nor an
  adult fly. Source redistribution terms need review before public release;
  until then it stays out of public snapshots and release builds.
- `fafb-v783.json`: female FAFB/FlyWire v783, local Codex downloads, CC BY-NC 4.0.
  [FlyWire Codex](https://codex.flywire.ai/api/download) and Dorkenwald et al.
  2024, DOI: 10.1038/s41586-024-07558-y. Princeton detections are used for this
  graph; Buhmann detections are archived separately, never added to Princeton.
- `fafb-morphology.json`: small hash-bound index of selected command-cell skeletons from
  `sk_lod1_783_healed.zip`, FAFB only, CC BY-NC 4.0. SWC units are nanometres.
  Imported entries are CRC-checked. Length is geometric LOD1 skeleton length,
  not a measured conduction delay or complete membrane geometry.
- `morphology/`: lazy-loaded individual FAFB cell files, no complete 30-MB
  morphology blob retained in memory.
- `malecns-morphology.json` and `malecns-morphology/`: 24 native MaleCNS
  command-cell skeletons. Publisher MD5, source SHA-256 and GCS generation
  recorded per cell. Original 8-nm units explicitly converted to nm. No
  female skeleton reused for a male neuron.
- `catalog.json`: generated counts and SHA-256 identities of the bundles and
  imported source files. Missing positions remain explicit, not invented.

Connection rows contain **unsigned integer contacts**. Transmitter predictions
are displayed separately: transmitter identity does not uniquely establish
postsynaptic receptor effects, synaptic efficacy or cellular dynamics.

Source archives and publisher metadata are kept in a local `datasets/` folder
next to the repository, outside Git; the 13.9-GB skeleton ZIP never belongs in
a commit.
Regeneration: `tools/acquire-connectomes.mjs`,
`tools/acquire-hemibrain-meta.mjs`, `tools/acquire-larval-supplement.mjs` and
`tools/acquire-banc-reviewed-matches.mjs` and `tools/import-specimens.py`.
Keep this notice and the source/license records with redistributed bundles.

`public-source-summary.json` records which public sources were found, not what
was downloaded.

`raw-source-audit.json` separately records a dated, checksum-based snapshot of
newly downloaded BANC, MANC v1.0, hemibrain v1.2 and male optic-lobe v1.1
tables. Its digests are compared with earlier *local* digests, not independently
authenticated publisher hashes. MANC, optic-lobe v1.1 and hemibrain v1.2 now
have bounded anatomy subsets. Raw synapse sites, most skeletons and mesh
archives are not integrated as explorer detail or active terrarium circuits.
Exact release identifiers are mirrored in `src/research-coverage.js`; neither
cross-animal joins nor additions of overlapping releases occur.

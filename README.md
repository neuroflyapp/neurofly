<h1 align="center">NeuroCause</h1>

<p align="center">
In-silico experiments on measured nervous systems. NeuroCause turns published
connectomes into models you can experiment on — closed-loop simulations with
stated assumptions, assays that reproduce exactly from their seed, and a
causal trace behind every result. Its first model is the fruit fly
<i>Drosophila melanogaster</i>, built on the <a href="https://codex.flywire.ai">FlyWire</a>
brain and the <a href="https://male-cns.janelia.org/">MaleCNS</a> nerve cord.
</p>

<p align="center"><a href="https://neuro-cause.com">neuro-cause.com</a></p>

---

## What this is

The fly's behaviour is not animated. It falls out of a leaky integrate-and-fire
**model** running over measured connectome data:

| | |
|---|---|
| Brain | 7,270 FlyWire FAFB v783 neurons, 784,219 signed synapse-count connections: a 6,338-neuron escape/steering subgraph, 16 thermosensors with 52 relays, and the taste (sugar/water, bitter → proboscis) and antennal-grooming (JO-F → DNg12) pathways |
| Nerve cord | 1,045 MaleCNS v1.0 neurons for walking, with leg-specific motor and sensory channels and feedback |
| Three flies | the original model above (female FlyWire brain + male MaleCNS cord, joined by a modelled population-rate interface); a **male** fly whose brain (7,337 neurons, 177,521 connections) and nerve cord (1,045 neurons) come from the same MaleCNS v1.0 animal; a **female** fly whose brain (7,013 neurons, 62,804 connections) and nerve cord (1,000 neurons) come from the same BANC v888 animal. In the single-animal flies the cord's descending and ascending cells are the brain's own cells, coupled spike by spike |
| Timestep | 1 ms neural integration; the full sensing → neurons → body → feedback loop at 120 Hz, in a Web Worker |
| Anatomy explorer | female BANC v888 and male MaleCNS v1.0 (brain + nerve cord each), the male MANC v1.0 nerve cord, the male optic lobe v1.1 and FAFB v783 — each a separate specimen, browsable as anatomy, never wired into another |

A looming object drives the real LC4/LPLC2 populations, which drive the real
giant fiber DNp01, which triggers takeoff. Wind reaches only the
wind/gravity Johnston's-organ neurons; near-field sound only the auditory
ones; temperature only the real hot and cold cells; sugar and bitter only the
gustatory receptor neurons; dust on the antennae only JO-F. What happens after
a stimulus arrives is decided by measured wiring, not by a script.

## What you can do with it

- **Watch and ask why.** Every takeoff, grooming bout, backward walk or
  proboscis extension comes with its causal chain: the trigger, the sensory
  neurons it reached, the synaptic input to the neurons that decided, and the
  rule that turned it into movement.
- **Virtual genetics and pharmacology.** Silence or activate any identified
  population or FlyWire cell type; scale transmitter classes.
- **Guided assays.** Ten protocols from the fly literature — looming
  threshold, LC4/LPLC2 silencing, sound vs wind, taste trade-off, dust
  grooming, activation screen, inhibition, habituation, associative learning,
  thermal preference — run on a separate virtual fly with statistics, and are
  reproducible from their seed.
- **Record everything.** 20 Hz CSV of every population rate, input and body
  state; run manifests with seeds, interventions and data fingerprints.
- **Play the Habitat.** A care and discovery game whose pet is the simulated
  fly itself: feed it (its taste circuit decides whether it drinks), collect
  every behaviour and neuron with the cells that decided it and their measured
  wiring, cross GAL4 driver and UAS effector lines whose offspring run with
  that genotype (silence the giant fiber, switch grooming on with red light,
  start a moonwalk with warmth), shape the terrarium, take photos, and work
  through the eight sentience criteria. Care values and ranks are game rules
  and are labelled as such; everything the fly does is the simulation.

## What this is not

Wiring and synapse counts are measured. Cell dynamics, sensory transduction,
body mechanics and behaviour are models. No output of this program is evidence
of subjective experience, pain, emotion or thought, and it deliberately shows
no "sentience score". The app reports its scope against the eight criteria of
Birch et al. (2021) and says which of them the model does not contain at all.

`windows/VALIDATION.md` is the full audit: benchmark results including the
findings the model does **not** reproduce, the verification suite, and a
corrections log of claims that were measured and then had to be withdrawn.

## Download

Both builds are on the [releases page](https://github.com/neuroflyapp/neurofly/releases/latest)
and at [neuro-cause.com](https://neuro-cause.com/#get), each with its SHA-256:

- **Windows 10 and 11 (64-bit):** a portable ZIP. Unzip it anywhere and start
  `NeuroCause.exe`; nothing is installed. The build is not code-signed yet, so
  Windows may warn on first start (More info → Run anyway).
- **Android 7.0 or newer** (phones and tablets with OpenGL ES 3.0): an APK.
  Android asks once to allow installs from the browser or file manager you
  open it with. The app runs entirely on the device and sends nothing.

The [software terms](https://neuro-cause.com/software-terms.html) apply to
every download; both apps ask you to accept them before they start.

## Run it from source

```sh
cd windows
npm install
npm start          # the app
npm test           # the test suites
npm run uitest     # end-to-end test of the running application
```

Requires Node.js 20+ on Windows 10/11. `windows/tools/build-portable.ps1` builds
the portable release from the committed files.

## Regenerating the neural data

The extracted bundles in `data/` are committed. To rebuild them from the raw
public dumps (which stay outside the repository):

```sh
python3 etl.py <raw_flywire_dir>          # brain circuit + point cloud
node etl_cell_annotations.mjs             # real FlyWire cell types
node etl_thermo_extension.mjs             # hot/cold thermosensors + relays
node etl_sensory_extension.mjs            # taste and antennal-grooming pathways
node etl_pathways.mjs                     # full-connectome pathway audit (sentience map)
python3 etl_malecns.py <raw_malecns_dir> --download   # walking circuit
python3 etl_malecns_brain.py <raw_malecns_dir>        # the male fly's brain (data/male/)
python3 etl_banc_adapter.py <raw_banc_dir> <out_dir>  # BANC in the MaleCNS vocabulary, then:
python3 etl_malecns_brain.py <out_dir> female "BANC v888"   # the female fly's brain
python3 etl_malecns.py <out_dir> --out data/female           # and her nerve cord
```

The anatomy-explorer bundles in `windows/assets/connectomes/` are built by
`windows/tools/acquire-connectomes.mjs` and `windows/tools/import-specimens.py`.

## Licences

Program code: [PolyForm Noncommercial License 1.0.0](LICENSE). Research,
teaching, personal study and use by non-profit and public institutions are
permitted; commercial use needs a licence from NeuroCause
(contact@neuro-cause.com). Bundled third-party software (three.js, Electron)
is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); the Android
app carries its own notice (three.js, Capacitor, AndroidX and others), shown
in the app under More → Licences and data sources.

The bundled neural data is licensed separately and requires attribution:
FlyWire FAFB v783 under **CC BY-NC 4.0** (non-commercial); MaleCNS v1.0, the
male optic lobe v1.1, MANC v1.0 and BANC v888 under **CC BY 4.0**. See [`data/DATA_LICENSE.md`](data/DATA_LICENSE.md),
[`data/LOCOMOTOR_PROVENANCE.md`](data/LOCOMOTOR_PROVENANCE.md) and
[`windows/assets/connectomes/README.md`](windows/assets/connectomes/README.md).
Because of the non-commercial data licence, NeuroCause is free and stays free.

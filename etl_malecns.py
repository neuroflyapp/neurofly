#!/usr/bin/env python3
"""NeuroFly's nerve-cord circuit: a bounded, anatomically identified leg
circuit extracted from the public MaleCNS v1.0 tables.

Needs numpy, pandas and pyarrow. The raw tables stay outside the repository:
    python3 etl_malecns.py <raw_dir> [--download]

Every edge is a published edge. Which leg, muscle or sense organ a cell
serves comes only from its annotations (motor subclass and soma side,
sensory entry nerve and root side) — never from its place in the graph, and
no joint or direction tuning is assigned. See data/LOCOMOTOR_PROVENANCE.md.
"""
import argparse
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.ipc as ipc
from fetch_specimen_data import fetch

RELEASE = "https://storage.googleapis.com/flyem-male-cns/v1.0"
BASE = f"{RELEASE}/connectome-data/flat-connectome/"
# The three tables (synapse confidence 0.5 where it applies).
FILES = dict(
    annotations="body-annotations-male-cns-v1.0-minconf-0.5.feather",
    neurotransmitters="body-neurotransmitters-male-cns-v1.0.feather",
    weights="connectome-weights-male-cns-v1.0-minconf-0.5.feather",
)
# Descending types whose rates the brain hands to the cord.
DN_TYPES = ("DNp09", "DNa01", "DNa02", "MDN", "DNg11")
# Legs in the body's order; a leg index is its segment's first index, +1 on
# the left.
LEG_ORDER = ["RF", "LF", "RM", "LM", "RH", "LH"]
LEG_SUBCLASS = {"fl": 0, "ml": 2, "hl": 4}                 # motor neurons, by subclass
LEG_NERVE = {"ProLN": 0, "MesoLN": 2, "MetaLN": 4}         # sensory neurons, by entry nerve
# Muscle channel -> the annotated motor types that drive it.
MOTOR_CHANNEL_TYPES = {
    "tibia_flexor": ("Ti flexor MN", "Acc. ti flexor MN"),
    "tibia_extensor": ("Ti extensor MN",),
    "trochanter_flexor": ("Tr flexor MN", "Acc. tr flexor MN"),
    "trochanter_extensor": ("Tr extensor MN",),
    "coxa_promotor": ("Tergopleural/Pleural promotor MN",),
    "coxa_remotor": ("Pleural remotor/abductor MN",),
    "coxa_anterior_rotator": ("Sternal anterior rotator MN",),
    "coxa_posterior_rotator": ("Sternal posterior rotator MN",),
}
MOTOR_CHANNEL = {cell_type: channel for channel, cell_types in MOTOR_CHANNEL_TYPES.items() for cell_type in cell_types}
# Annotated proprioceptor subclass -> receptor kind, in the order the report lists them.
SENSORY_KIND = dict([
    ("chordotonal organ", "chordotonal"),
    ("campaniform sensilla", "campaniform"),
    ("hair plate", "hair_plate"),
    ("leg", "proprioceptive_unspecified"),
])
# Synaptic sign by consensus transmitter — a modelling assumption, not a
# measurement. Every other transmitter (unknown or modulatory) gives a
# zero-current edge that stays in the anatomy with its raw contact count.
NT_SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}
# Channels every leg must reach from a descending neuron.
REQUIRED_CHANNELS = ["tibia_flexor", "tibia_extensor", "trochanter_flexor", "trochanter_extensor",
                     "coxa_anterior_rotator", "coxa_posterior_rotator"]
MIN_CONTACTS = 5              # edges with fewer contacts are not used
PREMOTOR_PER_CHANNEL = 12     # strongest DN-reachable partners per leg and motor channel
PARTNERS_PER_DN = 6           # strongest direct VNC targets of each descending cell
SENSORS_PER_KIND = 10         # per leg and receptor kind
ASCENDING_PER_DN = 4          # ascending cells returning onto each descending cell
ANNOTATION_FIELDS = ["type", "instance", "superclass", "class", "subclass", "somaSide", "rootSide",
                     "somaNeuromere", "entryNerve", "exitNerve", "receptorType", "flywireType",
                     "mancType", "mancBodyid", "matchingNotes", "status", "somaLocation"]
TRANSMITTER_FIELDS = ["consensus_nt", "predicted_nt", "predicted_nt_confidence", "ground_truth",
                      "celltype_predicted_nt", "celltype_predicted_nt_confidence"]
SIDE_NAMES = {"L": "left", "R": "right", "M": "center"}

# What the extraction states about itself (written into the circuit file).
SELECTION_NOTE = ("Every named leg motor neuron of the tibia and trochanter flexors/extensors, the coxa promotor/remotor "
                  "and the sternal anterior/posterior rotators; per leg and motor channel the 12 strongest VNC partners "
                  "reachable from a descending neuron; each descending neuron's strongest direct targets and the real "
                  "connecting cells they need; at most 10 sensory neurons per leg and receptor class; at most 4 "
                  "ascending neurons per descending neuron that close a real VNC-to-DN loop.")
MUSCLE_FUNCTION_SOURCE = {
    "url": "https://faculty.washington.edu/tuthill/docs/azevedo24_appendix.pdf",
    "title": "Azevedo et al. 2024, Supplementary Methods: Identification of leg motor neuron targets",
    "interpretation": "Per this table the sternal anterior/posterior rotators move the coxa forward/backward and the "
                      "trochanter flexors/extensors act as levators/depressors. The data keep every source muscle "
                      "channel separate; mapping coxal rotation and promotion/remotion onto a single joint of the "
                      "body model is a mechanical simplification."}
MODEL_NOTES = {
    "sensoryTuning": "The annotations give no joint or direction tuning; every angle, velocity, contact and load "
                     "transduction is an explicit assumption of the body model.",
    "premotorRole": "'premotor' labels the VNC interneurons selected on the retained routes from descending to motor "
                    "neurons. It includes connecting interneurons and does not claim that each contacts a motor neuron.",
    "flywireInterface": "The female FlyWire v783 brain and these male descending neurons come from different animals, "
                        "coupled by a modelled activity interface between cells of the same type and side; no "
                        "synapse between the two specimens is claimed.",
    "scope": "A leg locomotor subgraph, not the whole CNS. Muscles, body mechanics, neuron dynamics, sensory "
             "tuning, left-out inputs and neuromodulation are modelled or still open.",
}
CLOSURE_NOTE = ("Per target, the union of its strongest incoming VNC partners and its strongest GABA- or "
                "glutamatergic ones; each further round starts from the cells the previous round added. No "
                "contact is invented or reweighted.")
EXPANDED_PREMOTOR_NOTE = " With upstream closure it also includes the VNC partners that closure selected."
WEIGHT_NOTE = "Synaptic signs are assumptions of the model; rawSynapseCounts keep the measured contact counts."
LEG_ASSIGNMENT_NOTE = ("Motor neurons by subclass fl/ml/hl and somaSide; sensory neurons by entry nerve "
                       "ProLN/MesoLN/MetaLN and rootSide.")
CIRCUIT_SOURCE = "MaleCNS v1.0 leg locomotor circuit from the public annotated tables"


def clean(value):
    """A table value as plain JSON: numpy scalars and arrays converted, NaN and None as None."""
    if isinstance(value, np.ndarray):
        return [clean(item) for item in value]
    plain = value.item() if isinstance(value, (np.integer, np.floating)) else value
    missing = plain is None or (isinstance(plain, float) and np.isnan(plain))
    return None if missing else plain


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def ranked(series, count):
    """The `count` labels with the largest values; ties broken by body ID, so
    the result does not depend on the order of the input rows."""
    return sorted(series.index, key=lambda label: (-series.loc[label], int(label)))[:count]


def require(condition, message):
    """Scientific input checks must still run under Python's optimized mode."""
    if not condition:
        raise ValueError(message)


def indexed_table(frame, key, columns, label):
    require(set([key, *columns]).issubset(frame.columns), f"{label}: missing required columns")
    ids = frame[key]
    require(pd.api.types.is_integer_dtype(ids.dtype) and not ids.isna().any()
            and (ids > 0).all(), f"{label}: IDs must be positive exact integers")
    require(ids.is_unique, f"{label}: duplicate IDs")
    return frame.set_index(key, drop=False)


def fetch_sources(raw, download):
    """Each raw table's URL, size and SHA-256, downloading missing ones when asked."""
    sources = {}
    for key, name in FILES.items():
        target = raw / name
        if download and not target.exists():
            print("Downloading", name, flush=True)
            fetch(BASE + name, target)
        if not target.exists():
            raise SystemExit(f"{target} not found; run again with --download")
        sources[key] = {"url": BASE + name, "bytes": target.stat().st_size, "sha256": file_sha256(target)}
    return sources


def identified_cells(annotations):
    """Descending cells of DN_TYPES; leg motor neurons of a known channel with
    their leg; leg proprioceptors of a known kind with their leg."""
    a = annotations
    sided = ["L", "R"]
    descending = a[(a.superclass == "descending_neuron") & a.type.isin(DN_TYPES)]
    is_motor = ((a.superclass == "vnc_motor") & a.subclass.isin(LEG_SUBCLASS)
                & a.somaSide.isin(sided) & a.type.isin(MOTOR_CHANNEL))
    motors = a[is_motor].copy()
    # A leg index is its segment's right leg (0, 2, 4), +1 on the left.
    motors["leg"] = motors.subclass.map(LEG_SUBCLASS) + (motors.somaSide == "L").astype(int)
    motors["channel"] = motors.type.map(MOTOR_CHANNEL)
    is_sensor = ((a.superclass == "vnc_sensory") & (a["class"] == "mechanosensory_proprioceptive")
                 & a.entryNerve.isin(LEG_NERVE) & a.rootSide.isin(sided) & a.subclass.isin(SENSORY_KIND))
    sensory = a[is_sensor].copy()
    sensory["leg"] = sensory.entryNerve.map(LEG_NERVE) + (sensory.rootSide == "L").astype(int)
    sensory["kind"] = sensory.subclass.map(SENSORY_KIND)
    return descending, motors, sensory


def scan_weights(path, pool):
    """One pass over the weights table: every cell's full incoming and outgoing
    contacts, and the edges of at least MIN_CONTACTS within the pool."""
    # OSFile owns a bounded read buffer instead of exposing mapped-file views
    # through pandas. Always close the Windows file handle, including on a
    # validation error; returned arrays must not keep the source file locked.
    with pa.OSFile(str(path), "rb") as stream:
        return scan_weight_batches(ipc.open_file(stream), pool)


def scan_weight_batches(reader, pool):
    ids = pa.array(pool.index.to_numpy())
    full_in, full_out = (np.zeros(len(pool), dtype=np.int64) for _ in "io")
    for name in ["body_pre", "body_post", "weight"]:
        require(name in reader.schema.names, f"Weights: missing {name}")
        require(pa.types.is_integer(reader.schema.field(name).type), f"Weights: {name} must be integer-valued")
    kept, rows, contacts = [], 0, 0
    for number in range(reader.num_record_batches):
        batch = reader.get_batch(number)
        for name in ["body_pre", "body_post", "weight"]:
            require(batch[name].null_count == 0, f"Weights: null {name}")
            require(pc.all(pc.greater(batch[name], 0)).as_py() is not False, f"Weights: non-positive {name}")
        weights = batch["weight"].to_numpy()
        rows += len(batch)
        contacts += int(weights.sum())
        pre = pc.fill_null(pc.index_in(batch["body_pre"], value_set=ids), -1).to_numpy()
        post = pc.fill_null(pc.index_in(batch["body_post"], value_set=ids), -1).to_numpy()
        for position, totals in ((pre, full_out), (post, full_in)):
            inside = position >= 0
            np.add.at(totals, position[inside], weights[inside])
        keep = (pre >= 0) & (post >= 0) & (weights >= MIN_CONTACTS)
        if keep.any():
            kept.append(pa.Table.from_batches([batch.filter(pa.array(keep))]))
    require(bool(kept), "No qualifying edges within the annotated candidate pool")
    edges = pa.concat_tables(kept).to_pandas()
    require(not edges.duplicated(["body_pre", "body_post"]).any(), "Duplicate segment pairs in candidate graph")
    return edges, rows, contacts, full_in, full_out


def select_premotor(edges, descending, motors, vnc_ids):
    """VNC cells on descending-to-motor routes of at most two VNC hops: the
    strongest per leg and motor channel, the strongest direct targets of each
    descending cell, and for each two-hop cell the strongest real edge that
    connects it."""
    dn_ids = set(descending.index)
    dn_to_vnc = edges[edges.body_pre.isin(dn_ids) & edges.body_post.isin(vnc_ids)]
    direct = set(dn_to_vnc.body_post)
    bridges = edges[edges.body_pre.isin(direct) & edges.body_post.isin(vnc_ids)]
    reachable = direct | set(bridges.body_post)
    onto_motors = edges[edges.body_pre.isin(reachable) & edges.body_post.isin(set(motors.index))]
    premotor = set()
    for (_, _), channel_cells in motors.groupby(["leg", "channel"]):
        strength = onto_motors[onto_motors.body_post.isin(channel_cells.index)].groupby("body_pre").weight.sum()
        premotor.update(ranked(strength, PREMOTOR_PER_CHANNEL))
    for _, targets in dn_to_vnc.groupby("body_pre"):
        premotor.update(ranked(targets.set_index("body_post").weight, PARTNERS_PER_DN))
    for body in sorted(premotor - direct):
        feeders = bridges[bridges.body_post == body].set_index("body_pre").weight
        premotor.add(int(ranked(feeders, 1)[0]))
    return premotor


def select_sensors(edges, sensory, selected):
    """Per leg and receptor kind, the sensors with the most contacts onto the selection."""
    output = edges[edges.body_pre.isin(sensory.index) & edges.body_post.isin(selected)].groupby("body_pre").weight.sum()
    chosen = set()
    for (_, _), kind_cells in sensory.groupby(["leg", "kind"]):
        chosen.update(ranked(output[output.index.isin(kind_cells.index)], SENSORS_PER_KIND))
    return chosen


def select_ascending(edges, pool, sources_of_input, dn_ids):
    """Ascending cells that receive from the selected premotor or sensory
    cells AND synapse onto a selected descending cell: per descending cell,
    the strongest such returns. No cross-specimen edges."""
    ascending_ids = set(pool[pool.superclass == "ascending_neuron"].index)
    fed = edges[edges.body_pre.isin(sources_of_input) & edges.body_post.isin(ascending_ids)].groupby("body_post").weight.sum()
    returns = edges[edges.body_pre.isin(fed.index) & edges.body_post.isin(dn_ids)]
    chosen = set()
    for _, onto_dn in returns.groupby("body_post"):
        chosen.update(ranked(onto_dn.set_index("body_pre").weight, ASCENDING_PER_DN))
    return chosen


def upstream_closure(edges, vnc_ids, negative_bodies, premotor, selected, rounds, partners, inhibitory_partners):
    """Optional completeness experiment (rounds = 0 leaves the graph as is):
    each round adds, for every cell added last round, its strongest incoming
    VNC partners and its strongest GABA/glutamate ones. Real cells and
    contacts only — no oscillator connections are invented. Grows `premotor`
    and `selected` in place; returns the number added per round."""
    added_per_round = []
    frontier = set(premotor)
    vnc_incoming = edges[edges.body_pre.isin(vnc_ids)]
    for _ in range(rounds):
        incoming = vnc_incoming[vnc_incoming.body_post.isin(frontier)]
        additions = set()
        for _, feeders in incoming.groupby("body_post"):
            strength = feeders.set_index("body_pre").weight
            additions.update(ranked(strength, partners))
            additions.update(ranked(strength[strength.index.isin(negative_bodies)], inhibitory_partners))
        new_cells = additions - selected
        selected |= new_cells
        premotor |= new_cells
        frontier = new_cells
        added_per_round.append(len(new_cells))
    return added_per_round


def neuron_record(body, row, role, motors, sensory, nt):
    transmitter = nt.loc[body] if body in nt.index else None
    side = row.rootSide if role == "sensory" else row.somaSide
    if role == "motor":
        leg = int(motors.loc[body, "leg"])
    elif role == "sensory":
        leg = int(sensory.loc[body, "leg"])
    else:
        leg = None
    return dict(
        id=str(body), type=clean(row.type) or "untyped", role=role,
        side=SIDE_NAMES.get(side, "unknown"), leg=leg,
        motorChannel=MOTOR_CHANNEL.get(row.type) if role == "motor" else None,
        sensoryKind=SENSORY_KIND.get(row.subclass) if role == "sensory" else None,
        sensoryJoint=None, sensoryDirection=None,  # the annotations give no joint or direction tuning
        annotations={field: clean(row[field]) for field in ANNOTATION_FIELDS},
        neurotransmitter={field: (clean(transmitter[field]) if transmitter is not None else None)
                          for field in TRANSMITTER_FIELDS},
    )


def routes_from_descending(induced, dn_ids):
    """Breadth-first from the descending cells over the extracted edges, the
    strongest edge first: each reached cell's route as [pre, post, contacts] steps."""
    outgoing = defaultdict(list)
    for pre, post, count in induced[["body_pre", "body_post", "weight"]].itertuples(index=False, name=None):
        outgoing[pre].append((post, int(count)))
    starts = sorted(dn_ids)
    route = {body: [] for body in starts}
    queue = deque(starts)
    while queue:
        body = queue.popleft()
        for target, count in sorted(outgoing.get(body, ()), key=lambda step: (-step[1], step[0])):
            if target not in route:
                route[target] = route[body] + [[str(body), str(target), count]]
                queue.append(target)
    return route


def motor_evidence(motors, route, pool, induced):
    """Per leg and motor channel: the shortest descending route to one of its
    motor neurons, and how much of the channel's full input the extraction keeps."""
    paths, coverage = [], []
    kept_input = induced.groupby("body_post").weight.sum()
    for (leg, channel), channel_cells in motors.groupby(["leg", "channel"]):
        reached = sorted(set(channel_cells.index) & route.keys())
        require(bool(reached), f"No descending route to {LEG_ORDER[leg]} {channel}")
        nearest = min(reached, key=lambda body: (len(route[body]), body))
        paths.append({"leg": int(leg), "label": LEG_ORDER[leg], "motorChannel": channel,
                      "motorBodyId": str(nearest), "path": route[nearest]})
        full = int(pool.loc[channel_cells.index, "fullInput"].sum())
        kept = int(kept_input.reindex(channel_cells.index, fill_value=0).sum())
        coverage.append({"leg": int(leg), "label": LEG_ORDER[leg], "motorChannel": channel,
                         "neurons": len(channel_cells), "reachableNeurons": len(reached),
                         "fullIncomingContacts": full, "retainedIncomingContacts": kept,
                         "incomingFraction": round(kept / max(1, full), 6)})
    return paths, coverage


def closure_effect(induced, pool, premotor, base_premotor, selected, base_selected, negative_bodies, route):
    """What the optional closure did to the input of the original premotor cells, and their recurrence."""
    before = induced[induced.body_pre.isin(base_selected) & induced.body_post.isin(base_selected)]

    def onto_base(edge_table):
        return int(edge_table[edge_table.body_post.isin(base_premotor)].weight.sum())

    baseline, expanded = onto_base(before), onto_base(induced)
    full = int(pool.loc[sorted(base_premotor), "fullInput"].sum())
    recurrent = induced[induced.body_pre.isin(premotor) & induced.body_post.isin(premotor)]
    return dict(
        basePremotorNeurons=len(base_premotor),
        basePremotorFullIncomingContacts=full,
        basePremotorBaselineIncomingContacts=baseline,
        basePremotorExpandedIncomingContacts=expanded,
        basePremotorBaselineIncomingFraction=round(baseline / max(1, full), 6),
        basePremotorExpandedIncomingFraction=round(expanded / max(1, full), 6),
        expandedPremotorRecurrentEdges=len(recurrent),
        expandedPremotorRecurrentContacts=int(recurrent.weight.sum()),
        expandedPremotorRecurrentInhibitoryContacts=int(recurrent[recurrent.body_pre.isin(negative_bodies)].weight.sum()),
        addedNeuronsReachableFromDescending=len((selected - base_selected) & route.keys()),
    )


def extract(raw, out, download=False, closure_rounds=0, upstream_partners=6, inhibitory_partners=2):
    if min(closure_rounds, inhibitory_partners) < 0 or upstream_partners < 1:
        raise SystemExit("closure rounds and inhibitory partners must be 0 or more, upstream partners at least 1")
    for folder in (raw, out):
        folder.mkdir(parents=True, exist_ok=True)
    sources = fetch_sources(raw, download)

    annotations = indexed_table(pd.read_feather(raw / FILES["annotations"]), "bodyId",
                                ["superclass", "type", "class", "subclass", "somaSide", "rootSide", "entryNerve"], "Annotations")
    nt = indexed_table(pd.read_feather(raw / FILES["neurotransmitters"]), "body", ["consensus_nt"], "Transmitters")
    descending, motors, sensory = identified_cells(annotations)
    # Candidates: VNC interneurons, ascending cells and every identified cell.
    identified = set(descending.index) | set(motors.index) | set(sensory.index)
    pool = annotations[annotations.superclass.isin(["vnc_intrinsic", "ascending_neuron"])
                       | annotations.index.isin(identified)].sort_index()
    edges, raw_rows, raw_contacts, full_in, full_out = scan_weights(raw / FILES["weights"], pool)
    print(f"Scanned {raw_rows:,} segment pairs ({raw_contacts:,} contacts); "
          f"candidates: {len(pool):,} neurons, {len(edges):,} edges", flush=True)
    pool = pool.assign(fullInput=full_in, fullOutput=full_out)

    dn_ids, motor_ids = set(descending.index), set(motors.index)
    vnc_ids = set(pool[pool.superclass == "vnc_intrinsic"].index)
    premotor = select_premotor(edges, descending, motors, vnc_ids)
    selected = dn_ids | motor_ids | premotor
    selected_sensory = select_sensors(edges, sensory, selected)
    selected |= selected_sensory
    selected_ascending = select_ascending(edges, pool, premotor | selected_sensory, dn_ids)
    selected |= selected_ascending

    base_premotor, base_selected = set(premotor), set(selected)
    negative_bodies = set(nt[nt.consensus_nt.isin(["gaba", "glutamate"])].index)
    closure_counts = upstream_closure(edges, vnc_ids, negative_bodies, premotor, selected,
                                      closure_rounds, upstream_partners, inhibitory_partners)

    selected_ids = sorted(selected)
    index_of = {body: i for i, body in enumerate(selected_ids)}
    induced = edges[edges.body_pre.isin(selected) & edges.body_post.isin(selected)].sort_values(["body_pre", "body_post"])

    def role_of(body):
        if body in dn_ids:
            return "descending"
        if body in motor_ids:
            return "motor"
        if body in selected_sensory:
            return "sensory"
        return "ascending" if body in selected_ascending else "premotor"

    neurons = [neuron_record(body, annotations.loc[body], role_of(body), motors, sensory, nt) for body in selected_ids]
    edge_rows, unsigned_counts = [], []
    for pre, post, count in induced[["body_pre", "body_post", "weight"]].itertuples(index=False, name=None):
        transmitter = neurons[index_of[pre]]["neurotransmitter"]["consensus_nt"]
        edge_rows.append([index_of[pre], index_of[post], int(count) * NT_SIGN.get(transmitter, 0)])
        unsigned_counts.append(int(count))

    # Anatomical evidence, part of every extraction: real routes with real
    # body IDs and contact counts, and the checks the model relies on.
    route = routes_from_descending(induced, dn_ids)
    paths, coverage = motor_evidence(motors, route, pool, induced)
    for leg in range(6):
        for channel in REQUIRED_CHANNELS:
            require(any(p["leg"] == leg and p["motorChannel"] == channel for p in paths), f"Missing motor route: {LEG_ORDER[leg]} {channel}")
        require(any(n["leg"] == leg and n["role"] == "sensory" for n in neurons), f"Missing sensory cells: {LEG_ORDER[leg]}")
    require(bool(selected_ascending), "No real ascending return path survived selection")
    require(len(edge_rows) == len(unsigned_counts), "Signed edges and raw contacts are not aligned")
    require(all(count > 0 for count in unsigned_counts), "Non-positive retained contact count")

    roles = Counter(n["role"] for n in neurons)
    transmitters = Counter(n["neurotransmitter"]["consensus_nt"] or "missing" for n in neurons)
    silent = [count for e, count in zip(edge_rows, unsigned_counts) if e[2] == 0]
    sensors_by_leg_and_kind = {
        f"{LEG_ORDER[leg]}:{kind}": sum(n["role"] == "sensory" and n["leg"] == leg and n["sensoryKind"] == kind
                                        for n in neurons)
        for leg in range(6) for kind in SENSORY_KIND.values()}
    report = dict(
        rawSegmentPairRows=raw_rows, rawSegmentPairContacts=raw_contacts,
        annotationRows=len(annotations), neurotransmitterRows=len(nt),
        candidateNeurons=len(pool), candidateEdgesAtLeastFive=len(edges),
        neurons=len(neurons), edges=len(edge_rows), contacts=sum(unsigned_counts),
        roles=dict(roles), neurotransmitters=dict(transmitters),
        zeroCurrentEdges=len(silent), zeroCurrentContacts=sum(silent),
        descendingTypes=dict(Counter(descending.type)),
        motorCoverage=coverage, descendingToMotorPaths=paths,
        selectedSensoryByLegAndKind=sensors_by_leg_and_kind,
        ascendingReturnEdges=int(sum(induced.body_pre.isin(selected_ascending) & induced.body_post.isin(dn_ids))),
    )
    provenance = dict(
        dataset="MaleCNS v1.0", specimen="male Drosophila melanogaster",
        downloadPage="https://male-cns.janelia.org/download/", license="CC-BY-4.0",
        files=sources, edgeThreshold=MIN_CONTACTS, synapseConfidenceThreshold=0.5,
        selection=SELECTION_NOTE,
        weightModel=dict(consensusNTSigns=NT_SIGN, unknownAndModulatorySign=0, note=WEIGHT_NOTE),
        legAssignment=LEG_ASSIGNMENT_NOTE,
        muscleFunctionSource=MUSCLE_FUNCTION_SOURCE,
        **MODEL_NOTES,
    )
    if closure_rounds:
        closure = dict(rounds=closure_rounds, strongestPartnersPerTarget=upstream_partners,
                       strongestInhibitoryPartnersPerTarget=inhibitory_partners,
                       addedNeuronsByRound=closure_counts, note=CLOSURE_NOTE)
        provenance["upstreamClosure"] = closure
        report["upstreamClosure"] = {**closure, **closure_effect(induced, pool, premotor, base_premotor,
                                                                  selected, base_selected, negative_bodies, route)}
        provenance["premotorRole"] += EXPANDED_PREMOTOR_NOTE

    summary = {key: report[key] for key in ("neurons", "edges", "contacts", "roles", "zeroCurrentEdges")}
    circuit = dict(schemaVersion=1, source=CIRCUIT_SOURCE, legOrder=LEG_ORDER, neurons=neurons, edges=edge_rows,
                   rawSynapseCounts=unsigned_counts, provenance=provenance, summary=summary)
    outputs = {"locomotor_circuit.json": json.dumps(circuit, separators=(",", ":"), allow_nan=False),
               "locomotor_report.json": json.dumps(report, indent=2, allow_nan=False)}
    for name, text in outputs.items():
        (out / name).write_text(text + "\n")
    print(json.dumps(summary, indent=2))
    print("Checked: every leg has real descending routes to its coxal rotator and tibia/trochanter antagonist "
          f"channels, and sensory input; {len(selected_ascending)} ascending neurons feed back onto the native male DNs.")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("raw_dir", type=Path, help="folder holding the three MaleCNS tables")
    cli.add_argument("--download", action="store_true", help="fetch missing tables first")
    cli.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "data",
                     help="where to write the circuit and report (default: data/)")
    cli.add_argument("--closure-rounds", type=int, default=0,
                     help="rounds of the optional upstream VNC closure; 0 keeps the default circuit")
    cli.add_argument("--upstream-partners", type=int, default=6,
                     help="strongest incoming VNC partners added per target in each closure round")
    cli.add_argument("--inhibitory-partners", type=int, default=2,
                     help="strongest GABA/glutamate partners kept per target in addition")
    options = cli.parse_args()
    extract(options.raw_dir, options.out, options.download, options.closure_rounds,
            options.upstream_partners, options.inhibitory_partners)

#!/usr/bin/env python3
"""The single-specimen flies' brain circuits: the male from the same MaleCNS
v1.0 animal as its nerve cord (etl_malecns.py), the female from BANC v888
(through etl_banc_adapter.py's tables), so brain and cord come from one
specimen.

It follows etl.py's recipe for the female FlyWire brain as closely as the
data allow: the same core command and sensory cell types, the same reserved
partners per command population and for body feedback and sensory slots, the
same total number of partners, and synapses signed by their predicted
transmitter. Only cells of the head ganglia are candidates (brain, optic
lobes, and the axons of ascending and sensory cells reaching them); the
ventral nerve cord itself is the separate locomotor circuit.

Reads from <raw_dir> (the public MaleCNS Feather tables, see etl_malecns.py):
  body-annotations-male-cns-v1.0-minconf-0.5.feather
  body-neurotransmitters-male-cns-v1.0.feather
  connectome-weights-male-cns-v1.0-minconf-0.5.feather
and writes data/male/circuit.json and data/male/brain_points.json.

Differences from etl.py, all forced by the data and reported in the output:
  * Weights are whole-cell pair totals (FlyWire rows are per neuropil); pairs
    with fewer than 5 synapses are dropped, as Codex drops rows below 5.
  * Transmitters: the consensus prediction, else the cell type's prediction,
    else the cell's own (confidence >= 0.5). Histamine counts as inhibitory
    (histamine-gated chloride channels); unknown counts as excitatory, as in
    etl.py.
  * Positions: the annotated soma. Cells without one in the head (sensory
    afferents, ascending axons) are placed at the synapse-weighted centroid of
    their circuit partners and marked posEstimated; the position only places
    them in the 3D view. A dataset whose volume is tilted against FAFB's
    (BANC; source.json "frame": "fafb") is registered into FAFB's frame first.
  * The senses FlyWire's extensions add are embedded (add_senses): heat and
    cold cells with their relays, sugar/bitter receptors to the proboscis
    and ingestion motor neurons, JO-F to DNg12. And every JO-C/D/E (wind)
    cell with >= 20 synapses into the running circuit joins the sensory
    partners: ranked by total synapses with the core, only one or two of
    them made the reserved slots (FlyWire's circuit has 18).

Usage: python etl_malecns_brain.py <raw_dir> [out name under data/] [dataset label]
  male:   python etl_malecns_brain.py raw_malecns
  female: python etl_malecns_brain.py raw_banc_as_malecns female "BANC v888"
"""
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

RAW = sys.argv[1] if len(sys.argv) > 1 else "raw_malecns"
# Optional: output folder name under data/ and the specimen label (the female
# BANC fly runs this on etl_banc_adapter.py's tables: ... raw_banc_as_malecns female "BANC v888").
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", sys.argv[2] if len(sys.argv) > 2 else "male")
DATASET = sys.argv[3] if len(sys.argv) > 3 else "MaleCNS v1.0"
SEX = "female" if os.path.basename(OUT) == "female" else "male"
FILES = dict(annotations="body-annotations-male-cns-v1.0-minconf-0.5.feather",
             neurotransmitters="body-neurotransmitters-male-cns-v1.0.feather",
             weights="connectome-weights-male-cns-v1.0-minconf-0.5.feather")

CORE_TYPES = {
    "LC4": "lc4", "LPLC2": "lplc2", "DNp01": "gf", "DNa01": "dna01", "DNa02": "dna02",
    "DNp09": "dnp09", "DNg11": "dng11", "MDN": "mdn", "DNp02": "escw", "DNp04": "escw", "DNp11": "escw",
}
COMMAND_ROLES = ("gf", "dna01", "dna02", "dnp09", "dng11", "mdn", "escw")
PARTNERS_PER_COMMAND_ROLE = 60
RESERVED_BY_SUPER_CLASS = (("ascending", 400), ("sensory", 300))
MAX_PARTNERS = 6000
MAX_POINTS = 22000
MIN_SYNAPSES = 5

# MaleCNS superclass -> the super_class names the simulation and the brain view use (FlyWire's).
SUPER_CLASS = {
    "cb_intrinsic": "central", "cb_efferent": "central", "ol_intrinsic": "optic",
    "visual_projection": "visual_projection", "visual_projection_tbc": "visual_projection",
    "visual_centrifugal": "visual_centrifugal",
    "cb_sensory": "sensory", "cb_sensory_tbc": "sensory", "ol_sensory": "sensory", "sensory_descending": "sensory",
    "ascending_neuron": "ascending", "sensory_ascending": "ascending", "sensory_ascending_tbc": "ascending",
    "efferent_ascending": "ascending",
    "descending_neuron": "descending", "descending_neuron_tbc": "descending", "efferent_descending": "descending",
    "cb_motor": "motor", "cb_endocrine": "endocrine",
}
SUPER_CLASSES = ["optic", "central", "sensory", "visual_projection", "visual_centrifugal",
                 "descending", "ascending", "motor", "endocrine"]
NT_SIGN = {"acetylcholine": 1.0, "gaba": -1.0, "glutamate": -1.0, "histamine": -1.0,
           "dopamine": 0.5, "serotonin": 0.5, "octopamine": 0.5}
NT_CLASS = {"dopamine": 1, "serotonin": 2, "octopamine": 3}
EDGE_FORMAT = ("[pre_idx, post_idx, signed_synapse_count, nt_class] — "
               "nt_class: 0=other(ACH/GABA/GLUT/HIST/unknown) 1=DA 2=SER 3=OCT")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


def jo_group(cell_type):
    """Johnston's organ subgroups: A/B vibration (near-field sound), C/D/E deflection
    (wind, gravity), F the grooming mechanosensors (Kamikouchi et al. 2009)."""
    if not isinstance(cell_type, str) or not cell_type.startswith("JO-"):
        return None
    letter = cell_type[3:4]
    if letter in "AB" and not cell_type.startswith(("JO-A-unclear", "JO-B-unclear")):
        return "jo_auditory"
    if letter in "AB":
        return "jo_auditory"
    if letter in "CDE":
        return "jo_wind_gravity"
    if letter == "F":
        return "jof"
    return None


# ---- the senses outside the escape subgraph: heat/cold, taste, antennal grooming ----------------------------
# The same pathways etl_thermo_extension.mjs and etl_sensory_extension.mjs add
# to the FlyWire brain, selected with the same thresholds from this animal.
# A dataset that annotates taste modality and proboscis motor neurons itself
# (BANC, through etl_banc_adapter.py) writes them as FlyWire's sub-classes; the
# MaleCNS tables use none of these names, so the male circuit is unchanged.
NATIVE_SEEDS = {"sugar/water": "sugar", "bitter": "bitter"}
# Wind cells join when they send at least this many synapses into the running
# circuit (the thermo relays' threshold).
WIND = {"min_into_circuit": 20}
NATIVE_TARGETS = {"proboscis_motor_neuron": "proboscis", "haustellum_motor_neuron": "proboscis",
                  "ingestion_motor_neuron": "ingestion"}

# Cell identities come from FlyWire's own classification through the MaleCNS
# team's flywireType crosswalk (FlyWire type -> sub_class, from raw_flywire_v2
# when present, else the table below, read from FlyWire v783 on 2026-10-01).
FLYWIRE_TYPE_CLASS = {
    "sugar": {"LB3", "LB2d"},
    "bitter": {"LB1a", "LB1b", "LB1c", "LB1e"},
    "hot": {"TRN_VP2"},
    "cold": {"TRN_VP3a", "TRN_VP3b"},
    "proboscis": {"CB0845", "CB0720", "CB0762", "CB0858", "CB0861", "CB0911", "CB0783", "CB0871", "CB0789", "CB0875", "CB0882"},
    "ingestion": {"MN10", "MNx01", "CB0915", "MNx03", "CB0715", "CB0703", "CB0701", "CB0769", "CB0700", "CB0708", "CB0728", "CB0914"},
}
THERMO = dict(min_from_seeds=5, min_into_circuit=20, max_bridges=150)
SENSE = dict(min_pair=5, min_side_2hop=10, min_first_layer=10, max_2hop=100, max_second=80, max_first=100)


def flywire_crosswalk(raw_flywire="raw_flywire_v2"):
    """FlyWire type -> group, from FlyWire's classification when the raw tables are present."""
    import csv
    import gzip
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), raw_flywire)
    if not os.path.exists(os.path.join(path, "classification.csv.gz")):
        return {g: set(v) for g, v in FLYWIRE_TYPE_CLASS.items()}, "built-in table"
    sub = {}
    with gzip.open(os.path.join(path, "classification.csv.gz"), "rt") as handle:
        for row in csv.DictReader(handle):
            sub[row["root_id"]] = (row["class"], row["sub_class"])
    groups = defaultdict(set)
    want = {("gustatory", "sugar/water"): "sugar", ("gustatory", "bitter"): "bitter", ("thermosensory", "heating"): "hot",
            ("thermosensory", "cold"): "cold"}
    with gzip.open(os.path.join(path, "consolidated_cell_types.csv.gz"), "rt") as handle:
        reader = csv.reader(handle)
        next(reader)
        for row in reader:
            cls = sub.get(row[0])
            if not cls:
                continue
            if cls in want:
                groups[want[cls]].add(row[1].strip())
            elif cls[1] in ("proboscis_motor_neuron", "haustellum_motor_neuron"):
                groups["proboscis"].add(row[1].strip())
            elif cls[1] == "ingestion_motor_neuron":
                groups["ingestion"].add(row[1].strip())
    return groups, "FlyWire v783 classification.csv + consolidated_cell_types.csv"


def add_senses(ann, head, super_of, members, index_of, edges, nt_of, transmitter, weights, pre_all, post_all, w_all):
    crosswalk, crosswalk_source = flywire_crosswalk()

    def groups_of(row):
        fly = row["flywireType"] if isinstance(row["flywireType"], str) else ""
        names = {t.strip() for t in fly.split(",") if t.strip()}
        if isinstance(row["type"], str):
            names.add(row["type"])
        return {g for g, types in crosswalk.items() if names & types}

    seeds = {"hot": set(), "cold": set(), "sugar": set(), "bitter": set(), "jof": set()}
    wind_cells = set()   # JO-C/D/E candidates (not a pathway seed: see the wind section)
    targets = {"proboscis": set(), "ingestion": set(), "dng12": set()}
    usable = set(int(b) for b in head.index)
    for body, row in ann.iterrows():
        body = int(body)
        if body not in usable:
            continue
        cell_type = row["type"] if isinstance(row["type"], str) else ""
        found = groups_of(row)
        if row["class"] == "thermosensory":
            for g in ("hot", "cold"):
                if g in found:
                    seeds[g].add(body)
        if row["class"] == "gustatory":
            for g in ("sugar", "bitter"):
                if g in found:
                    seeds[g].add(body)
            # a dataset's own modality, written in FlyWire's vocabulary (BANC adapter)
            if row["subclass"] in NATIVE_SEEDS:
                seeds[NATIVE_SEEDS[row["subclass"]]].add(body)
        if cell_type.startswith("JO-F"):
            seeds["jof"].add(body)
        if jo_group(cell_type) == "jo_wind_gravity" and super_of.get(body) == "sensory":
            wind_cells.add(body)
        if row["superclass"] == "cb_motor":
            for g in ("proboscis", "ingestion"):
                if g in found:
                    targets[g].add(body)
            if row["subclass"] in NATIVE_TARGETS:
                targets[NATIVE_TARGETS[row["subclass"]]].add(body)
        if cell_type.startswith("DNg12"):
            targets["dng12"].add(body)
    print("sense seeds:", {k: len(v) for k, v in seeds.items()}, "targets:", {k: len(v) for k, v in targets.items()},
          "| crosswalk:", crosswalk_source)

    strong = pc.greater_equal(w_all, SENSE["min_pair"])
    all_seeds = set().union(*seeds.values())
    all_targets = set().union(*targets.values())
    core = set(members)
    core_arr = pa.array(np.array(sorted(core), dtype=np.int64))
    # pass 1: everything leaving a seed, everything entering a target, and every candidate's drive into the circuit
    seed_arr = pa.array(np.array(sorted(all_seeds), dtype=np.int64))
    target_arr = pa.array(np.array(sorted(all_targets), dtype=np.int64))
    sel = pc.and_(strong, pc.or_(pc.or_(pc.is_in(pre_all, value_set=seed_arr), pc.is_in(post_all, value_set=target_arr)),
                                 pc.is_in(post_all, value_set=core_arr)))
    rows = weights.filter(sel).to_pandas()
    seed_group = {b: g for g, cells in seeds.items() for b in cells}
    target_group = {b: g for g, cells in targets.items() for b in cells}
    modality_of_seed = {"sugar": "taste", "bitter": "taste", "jof": "grooming", "hot": "thermo", "cold": "thermo"}
    modality_of_target = {"proboscis": "taste", "ingestion": "taste", "dng12": "grooming"}
    from_seeds = {m: defaultdict(int) for m in ("taste", "grooming")}
    to_targets = {m: defaultdict(int) for m in ("taste", "grooming")}
    from_thermo = defaultdict(lambda: {"hot": 0, "cold": 0})
    into_circuit = defaultdict(int)
    for pre, post, w in rows.itertuples(index=False):
        pre, post, w = int(pre), int(post), int(w)
        g = seed_group.get(pre)
        if g:
            m = modality_of_seed[g]
            if m == "thermo":
                from_thermo[post][g] += w
            else:
                from_seeds[m][post] += w
        t = target_group.get(post)
        if t:
            to_targets[modality_of_target[t]][pre] += w
        if post in core:
            into_circuit[pre] += w

    added = {}   # body -> record
    tags = {}    # core body -> tag

    def place(body, record):
        if body in core:
            tags.setdefault(body, {}).update({k: v for k, v in record.items() if k in ("extension", "sensoryGroup", "motorGroup", "thermoGroup", "pathRole")})
        elif body in usable and body not in added:
            added[body] = record

    # heat and cold: the sensors, and their strongest two-synapse relays into the circuit
    for g in ("hot", "cold"):
        for b in sorted(seeds[g]):
            place(b, {"extension": "thermo", "thermoGroup": g, "layer": 0})
    bridges = []
    for body, s in from_thermo.items():
        if body in core or body in all_seeds or body not in usable:
            continue
        frm, into = s["hot"] + s["cold"], into_circuit.get(body, 0)
        if frm < THERMO["min_from_seeds"] or into < THERMO["min_into_circuit"]:
            continue
        bridges.append((min(frm, into), body, s["hot"], s["cold"], into))
    bridges.sort(key=lambda x: (-x[0], x[1]))
    for _, body, hot, cold, into in bridges[:THERMO["max_bridges"]]:
        place(body, {"extension": "thermo", "layer": 1, "fromHot": hot, "fromCold": cold, "intoCircuit": into})
    print(f"thermo relays kept: {min(len(bridges), THERMO['max_bridges'])} of {len(bridges)}")

    # taste and grooming: seeds, targets, mediators, and the A -> B layers
    for g, m in (("sugar", "taste"), ("bitter", "taste"), ("jof", "grooming")):
        for b in sorted(seeds[g]):
            place(b, {"extension": m, "sensoryGroup": g, "layer": 0})
    for g, m in (("proboscis", "taste"), ("ingestion", "taste"), ("dng12", "grooming")):
        for b in sorted(targets[g]):
            place(b, {"extension": m, "motorGroup": g, "layer": 3})
    for m in ("taste", "grooming"):
        mseeds = {b for b, g in seed_group.items() if modality_of_seed[g] == m}
        mtargets = {b for b, g in target_group.items() if modality_of_target[g] == m}
        excluded = mseeds | mtargets
        two = sorted(((min(f, to_targets[m].get(b, 0)), b) for b, f in from_seeds[m].items()
                      if f >= SENSE["min_side_2hop"] and to_targets[m].get(b, 0) >= SENSE["min_side_2hop"]
                      and b not in excluded and b in usable), key=lambda x: (-x[0], x[1]))
        chosen = {}
        for _, b in two[:SENSE["max_2hop"]]:
            chosen[b] = "mediator"
        first_pool = {b for b, f in from_seeds[m].items() if f >= SENSE["min_first_layer"] and b not in excluded}
        second_pool = {b for b in to_targets[m] if b not in excluded}
        if first_pool and second_pool:
            sel = pc.and_(strong, pc.and_(pc.is_in(pre_all, value_set=pa.array(np.array(sorted(first_pool), dtype=np.int64))),
                                          pc.is_in(post_all, value_set=pa.array(np.array(sorted(second_pool), dtype=np.int64)))))
            ab = weights.filter(sel).to_pandas()
        else:
            ab = []
        into_b = defaultdict(float)
        for a, b, w in (ab.itertuples(index=False) if len(ab) else []):
            into_b[int(b)] += int(w) * min(1.0, from_seeds[m].get(int(a), 0) / 100)
        bs = sorted(((min(v, to_targets[m].get(b, 0)), b) for b, v in into_b.items() if b not in chosen and b in usable),
                    key=lambda x: (-x[0], x[1]))
        kept_b = {b for s, b in bs[:SENSE["max_second"]] if s >= SENSE["min_side_2hop"]}
        for b in kept_b:
            chosen[b] = "second"
        onto_b = defaultdict(int)
        for a, b, w in (ab.itertuples(index=False) if len(ab) else []):
            if int(b) in kept_b:
                onto_b[int(a)] += int(w)
        as_ = sorted(((min(from_seeds[m].get(a, 0), v), a) for a, v in onto_b.items() if a not in chosen and a in usable),
                     key=lambda x: (-x[0], x[1]))
        for s, a in as_[:SENSE["max_first"]]:
            if s >= SENSE["min_side_2hop"]:
                chosen[a] = "first"
        for b, layer in sorted(chosen.items()):
            place(b, {"extension": m, "layer": 1 if layer in ("mediator", "first") else 2, "pathRole": layer})
        print(f"{m}: mediators {sum(1 for v in chosen.values() if v == 'mediator')}, first {sum(1 for v in chosen.values() if v == 'first')}, "
              f"second {len(kept_b)}")

    # wind: the deflection-sensitive Johnston's-organ cells (JO-C/D/E) that
    # synapse onto the running circuit. The reserved sensory partners are
    # ranked by their total synapses with the core, and in these animals few
    # wind cells rank high enough (MaleCNS 2, BANC 1; FlyWire's circuit 18):
    # the wind sense would rest on one or two cells. They join the sensory
    # partners exactly as FlyWire's JO-C/D/E do (antennal input population,
    # JO group from their cell type); `addedSensory` records why they are in.
    wind = sorted(b for b in wind_cells if b not in core and b in usable
                  and into_circuit.get(b, 0) >= WIND["min_into_circuit"])
    for b in wind:
        place(b, {"addedSensory": "wind"})
    print(f"wind: {len(wind)} JO-C/D/E cells with >= {WIND['min_into_circuit']} synapses into the circuit "
          f"(of {len(wind_cells)}; {len(wind_cells & core)} already core partners)")

    # append the new cells; every connection between them and the running circuit, both ways
    start = len(members)
    new_members = list(added)
    for k, b in enumerate(new_members):
        index_of[b] = start + k
    all_members = members + new_members
    nt_of.update({b: transmitter(b) for b in new_members})
    if new_members:
        new_arr = pa.array(np.array(new_members, dtype=np.int64))
        all_arr = pa.array(np.array(all_members, dtype=np.int64))
        sel = pc.and_(strong, pc.or_(pc.and_(pc.is_in(pre_all, value_set=new_arr), pc.is_in(post_all, value_set=all_arr)),
                                     pc.and_(pc.is_in(post_all, value_set=new_arr), pc.is_in(pre_all, value_set=all_arr))))
        extra = weights.filter(sel).to_pandas()
        for pre, post, w in extra.itertuples(index=False):
            name = nt_of[int(pre)]
            sign = NT_SIGN.get(name, 1.0)
            edges.append((index_of[int(pre)], index_of[int(post)], round(int(w) * sign, 1), NT_CLASS.get(name, 0)))
    summary = {
        "crosswalk": crosswalk_source,
        "seeds": {k: len(v) for k, v in seeds.items()}, "targets": {k: len(v) for k, v in targets.items()},
        "addedNeurons": len(new_members), "taggedCoreNeurons": len(tags), "addedWindCells": len(wind),
        "thresholds": {"thermo": THERMO, "taste_grooming": SENSE, "wind": WIND},
    }
    print(f"senses: +{len(new_members)} neurons, {len(tags)} core cells tagged")
    return all_members, added, tags, summary


def fafb_registration(head, soma, raw_flywire="raw_flywire_v2"):
    """A similarity transform (rotation, or rotation with reflection; uniform
    scale; shift) from this dataset's soma positions into FAFB's, fitted to the
    centroids of the cell types both name (the dataset's flywireType, per
    side). BANC's volume is tilted against FAFB's; registered, its brain is
    drawn in the frame the FlyWire and MaleCNS brains share. Returns
    (function nm -> FAFB nm, report)."""
    import csv
    import gzip
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), raw_flywire)
    side_of, at = {}, {}
    with gzip.open(os.path.join(path, "classification.csv.gz"), "rt") as handle:
        for row in csv.DictReader(handle):
            side_of[row["root_id"]] = {"left": "L", "right": "R"}.get(row["side"])
    with gzip.open(os.path.join(path, "coordinates.csv.gz"), "rt") as handle:
        for row in csv.DictReader(handle):
            at.setdefault(row["root_id"], [float(v) for v in row["position"].strip("[]").split()])
    sums = defaultdict(lambda: [np.zeros(3), 0])
    with gzip.open(os.path.join(path, "consolidated_cell_types.csv.gz"), "rt") as handle:
        for row in csv.DictReader(handle):
            root, side = row["root_id"], side_of.get(row["root_id"])
            if side and root in at and row["primary_type"]:
                entry = sums[(row["primary_type"].strip(), side)]
                entry[0] += at[root]
                entry[1] += 1
    fafb = {k: s / n for k, (s, n) in sums.items()}
    mine = defaultdict(lambda: [np.zeros(3), 0])
    for body, p in soma.items():
        row = head.loc[body]
        fly, side = row["flywireType"], row["somaSide"]
        if isinstance(fly, str) and "," not in fly and side in ("L", "R") and (fly.strip(), side) in fafb:
            entry = mine[(fly.strip(), side)]
            entry[0] += p
            entry[1] += 1
    keys = sorted(mine)
    a = np.array([mine[k][0] / mine[k][1] for k in keys])
    b = np.array([fafb[k] for k in keys])
    use = np.ones(len(keys), bool)
    for _ in range(3):   # fit, drop matches beyond 3x the median residual, refit
        ma, mb = a[use].mean(0), b[use].mean(0)
        u, sv, vt = np.linalg.svd((b[use] - mb).T @ (a[use] - ma))
        rot = u @ vt
        scale = sv.sum() / ((a[use] - ma) ** 2).sum()
        moved = (a - ma) @ rot.T * scale + mb
        residual = np.linalg.norm(moved - b, axis=1)
        use = residual <= 3 * np.median(residual[use])
    rms = float(np.sqrt((residual[use] ** 2).mean()))
    report = {"to": "FAFB v783 (FlyWire coordinates.csv)", "matchedTypeSides": int(use.sum()), "candidates": len(keys),
              "rmsMicrometres": round(rms / 1000, 1), "reflected": bool(np.linalg.det(rot) < 0)}
    print("frame registered to FAFB:", report)
    return (lambda p: (np.asarray(p) - ma) @ rot.T * scale + mb), report


def main():
    raw = os.path.abspath(RAW)
    print("reading annotations and transmitters…")
    ann = feather.read_table(os.path.join(raw, FILES["annotations"]),
                             columns=["bodyId", "type", "flywireType", "instance", "superclass", "class", "subclass", "somaSide",
                                      "somaLocation"]).to_pandas()
    ann = ann.drop_duplicates("bodyId").set_index("bodyId")
    nt = feather.read_table(os.path.join(raw, FILES["neurotransmitters"]),
                            columns=["body", "consensus_nt", "celltype_predicted_nt", "celltype_predicted_nt_confidence",
                                     "predicted_nt", "predicted_nt_confidence"]).to_pandas().set_index("body")

    head = ann[ann["superclass"].isin(SUPER_CLASS.keys())]
    super_of = head["superclass"].map(SUPER_CLASS)
    print(f"annotated cells: {len(ann)}, head-ganglia candidates: {len(head)}")

    role_of, type_of = {}, {}
    for body, cell_type in head["type"].items():
        role = CORE_TYPES.get(cell_type)
        if role:
            role_of[int(body)] = role
            type_of[int(body)] = cell_type
    found = Counter(type_of.values())
    print("core populations:", dict(found))
    if not (found.get("LC4") and found.get("LPLC2") and found.get("DNp01")):
        sys.exit("FATAL: missing a core population")
    core = np.array(sorted(role_of), dtype=np.int64)
    candidates = np.array(head.index.values, dtype=np.int64)

    print("scanning connectome weights (pass 1: partners of the core)…")
    weights = feather.read_table(os.path.join(raw, FILES["weights"]), memory_map=True)
    pre_all, post_all, w_all = weights.column("body_pre"), weights.column("body_post"), weights.column("weight")
    strong = pc.greater_equal(w_all, MIN_SYNAPSES)
    pre_core, post_core = pc.is_in(pre_all, value_set=pa.array(core)), pc.is_in(post_all, value_set=pa.array(core))
    pre_cand, post_cand = pc.is_in(pre_all, value_set=pa.array(candidates)), pc.is_in(post_all, value_set=pa.array(candidates))
    touching = pc.and_(strong, pc.or_(pc.and_(pre_core, post_cand), pc.and_(post_core, pre_cand)))
    rows = weights.filter(touching).to_pandas()
    rows = rows[rows["body_pre"].isin(role_of).values ^ rows["body_post"].isin(role_of).values]
    total, per_role = defaultdict(int), defaultdict(lambda: defaultdict(int))
    for pre, post, w in rows.itertuples(index=False):
        core_cell, partner = (pre, post) if pre in role_of else (post, pre)
        total[partner] += int(w)
        per_role[role_of[core_cell]][partner] += int(w)
    print(f"candidate partners: {len(total)}")

    def strongest_first(strength):
        return [key for key, _ in sorted(strength.items(), key=lambda item: (-item[1], item[0]))]

    chosen, taken = [], set(role_of)

    def take(cells, limit):
        added = 0
        for cell in cells:
            if cell in taken:
                continue
            taken.add(cell); chosen.append(cell); added += 1
            if added == limit:
                break

    ranked = strongest_first(total)
    for role in COMMAND_ROLES:
        take(strongest_first(per_role[role]), PARTNERS_PER_COMMAND_ROLE)
    for super_class, slots in RESERVED_BY_SUPER_CLASS:
        take([c for c in ranked if super_of.get(c) == super_class], slots)
    take(ranked, MAX_PARTNERS - len(chosen))
    members = sorted(role_of, key=lambda b: (list(CORE_TYPES).index(type_of[b]), b)) + chosen
    index_of = {b: i for i, b in enumerate(members)}
    print(f"members: {len(members)} ({len(role_of)} core + {len(chosen)} partners); "
          f"partner super_classes: {dict(Counter(super_of.get(c) for c in chosen))}")

    print("scanning connectome weights (pass 2: edges among members)…")
    mem = pa.array(np.array(members, dtype=np.int64))
    inside = pc.and_(strong, pc.and_(pc.is_in(pre_all, value_set=mem), pc.is_in(post_all, value_set=mem)))
    edges_tab = weights.filter(inside).to_pandas()

    def transmitter(body):
        if body not in nt.index:
            return "unknown"
        r = nt.loc[body]
        if isinstance(r, type(nt)):  # duplicate rows: take the first
            r = r.iloc[0]
        if r["consensus_nt"] and r["consensus_nt"] != "unclear":
            return r["consensus_nt"]
        if r["celltype_predicted_nt"] and (r["celltype_predicted_nt_confidence"] or 0) >= 0.5:
            return r["celltype_predicted_nt"]
        if r["predicted_nt"] and (r["predicted_nt_confidence"] or 0) >= 0.5:
            return r["predicted_nt"]
        return "unknown"

    nt_of = {b: transmitter(b) for b in members}
    print("member transmitters:", dict(Counter(nt_of.values())))
    edges, unknown = [], 0
    for pre, post, w in edges_tab.itertuples(index=False):
        name = nt_of[int(pre)]
        sign = NT_SIGN.get(name)
        if sign is None:
            sign = 1.0
            unknown += 1
        edges.append((index_of[int(pre)], index_of[int(post)], round(int(w) * sign, 1), NT_CLASS.get(name, 0)))
    print(f"core circuit edges: {len(edges)} (unknown transmitter on {unknown})")
    core_count = len(members)
    members, added, tags, senses = add_senses(ann, head, super_of, members, index_of, edges, nt_of, transmitter,
                                              weights, pre_all, post_all, w_all)
    edges.sort(key=lambda e: (e[0], e[1]))
    print(f"circuit edges with the senses: {len(edges)}")

    # positions: annotated somata of head-ganglia cells; the frame is fitted to those
    soma = {}
    for body, loc in head["somaLocation"].items():
        if loc is not None and len(loc) == 3 and super_of.get(body) not in ("ascending",):
            soma[int(body)] = tuple(float(v) for v in loc)
    frame = None
    adapted = os.path.join(raw, "source.json")
    if os.path.exists(adapted):
        with open(adapted, encoding="utf-8") as handle:
            if json.load(handle).get("frame") == "fafb":
                register, frame = fafb_registration(head, soma)
                soma = {b: tuple(float(v) for v in register(p)) for b, p in soma.items()}
    lows = [min(p[a] for p in soma.values()) for a in range(3)]
    highs = [max(p[a] for p in soma.values()) for a in range(3)]
    if frame:
        # A registered volume keeps a few root points far outside the brain
        # (cells whose recorded root lies in a nerve or the neck): the frame
        # is fitted to the 0.5-99.5 percentile box of the somata instead.
        cloud = np.array(list(soma.values()))
        lows, highs = list(np.percentile(cloud, 0.5, axis=0)), list(np.percentile(cloud, 99.5, axis=0))
    centre = [(lo + hi) / 2 for lo, hi in zip(lows, highs)]
    scale = 20.0 / max(hi - lo for lo, hi in zip(lows, highs))

    def to_view(p):  # FlyEM: x left-right, y dorsal->ventral, z anterior->posterior (as FAFB)
        return [round((p[0] - centre[0]) * scale, 3), round(-(p[1] - centre[1]) * scale, 3), round(-(p[2] - centre[2]) * scale, 3)]

    pos = {b: to_view(soma[b]) for b in members if b in soma}
    estimated = set()
    partners = defaultdict(list)
    for i, j, w, _ in edges:
        partners[members[i]].append((members[j], abs(w)))
        partners[members[j]].append((members[i], abs(w)))
    for b in members:
        if b in pos:
            continue
        near = [(pos[o], w) for o, w in partners[b] if o in pos]
        if near:
            total_w = sum(w for _, w in near)
            pos[b] = [round(sum(p[a] * w for p, w in near) / total_w, 3) for a in range(3)]
        else:
            pos[b] = [0.0, 0.0, 0.0]
        estimated.add(b)

    neurons = []
    groups = Counter()
    for b in members:
        row = ann.loc[b]
        super_class = super_of.get(b, "central")
        record = {"id": str(b), "type": type_of.get(b, super_class), "role": role_of.get(b, "other"),
                  "side": {"L": "left", "R": "right"}.get(row["somaSide"], "") if isinstance(row["somaSide"], str) else "",
                  "pos": pos[b]}
        if b in added:
            record.update(added[b])
        elif b in tags:
            tag = dict(tags[b])
            if "thermoGroup" in tag:
                record["thermoGroup"] = tag["thermoGroup"]
            else:
                record["extensionTag"] = tag
        if isinstance(row["type"], str) and row["type"]:
            record["cellType"] = row["type"]
        group = jo_group(row["type"])
        if group and super_class == "sensory" and not record.get("extension"):
            record["sensoryGroup"] = group
            groups[group] += 1
        if b in estimated:
            record["posEstimated"] = True
        neurons.append(record)
    print("JO sensory groups:", dict(groups), "| positions estimated:", len(estimated))

    os.makedirs(OUT, exist_ok=True)
    sources = {name: {"file": FILES[name], "sha256": sha256(os.path.join(raw, FILES[name]))} for name in FILES}
    adapted = os.path.join(raw, "source.json")   # tables renamed from another dataset (etl_banc_adapter.py)
    if os.path.exists(adapted):
        with open(adapted, encoding="utf-8") as handle:
            origin = json.load(handle)["provenance"]
        sources = {**origin["files"], "adapter": origin["adapter"]}
    circuit = {"specimen": f"{DATASET} ({SEX}, brain and nerve cord of one animal)", "neurons": neurons, "edges": edges,
               "edge_format": EDGE_FORMAT, "sensoryGroupCounts": dict(groups), "coreNeurons": core_count, "senses": senses,
               "source": f"{DATASET} connectome-weights (pair totals >= {MIN_SYNAPSES}, signed by predicted transmitter)",
               "sources": sources, "generator": "etl_malecns_brain.py"}
    if frame:
        circuit["frame"] = frame
    with open(os.path.join(OUT, "circuit.json"), "w") as handle:
        json.dump(circuit, handle)
    class_index = {name: i for i, name in enumerate(SUPER_CLASSES)}
    located = sorted(soma)
    stride = max(1, len(located) // MAX_POINTS)
    points = [[*to_view(soma[b]), class_index.get(super_of.get(b, "central"), 1)] for b in located[::stride]]
    with open(os.path.join(OUT, "brain_points.json"), "w") as handle:
        json.dump({"classes": SUPER_CLASSES, "points": points, "source": f"{DATASET} soma locations (head ganglia)"}, handle)
    print(f"{SEX} circuit: {len(neurons)} neurons, {len(edges)} edges; {len(points)} points")

    members_of = defaultdict(set)
    for b, role in role_of.items():
        members_of[role].add(index_of[b])
    looms = members_of["lc4"] | members_of["lplc2"]
    loom_gf = [e for e in edges if e[0] in looms and e[1] in members_of["gf"]]
    print(f"sanity: direct loom->GF edges: {len(loom_gf)}, total syn: {sum(abs(e[2]) for e in loom_gf):.0f}")
    for role in COMMAND_ROLES:
        print(f"  in-circuit drive onto {role}: {sum(abs(e[2]) for e in edges if e[1] in members_of[role]):.0f} syn")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""NeuroFly's brain circuit, extracted from the FlyWire Codex v783 tables.

Reads four gzipped CSV tables from <raw_dir>:
  classification.csv.gz          root_id, flow, super_class, class, sub_class, hemilineage, side, nerve
  coordinates.csv.gz             root_id, position "[x y z]" (nm), supervoxel_id
  connections.csv.gz             pre_root_id, post_root_id, neuropil, syn_count, nt_type
  consolidated_cell_types.csv.gz root_id, primary_type, additional_type(s)

and writes into data/ next to this script:
  brain_points.json  ~22k real soma positions with their super_class (the brain view's cloud)
  circuit.json       the simulated circuit: the core command and sensory populations, their
                     strongest partners, and every connection row among them as a signed
                     synapse count with its transmitter class

Usage: python3 etl.py <raw_dir>
"""
import csv
import gzip
import json
import os
import sys
from collections import Counter, defaultdict

RAW_DIR = sys.argv[1] if len(sys.argv) > 1 else "."
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# FlyWire primary_type -> NeuroFly role slug. Matched on primary_type only:
# matching additional types too pulled in near misses (DNp71 as DNp09,
# DNae001 as DNa01).
CORE_TYPES = {
    "LC4": "lc4", "LPLC2": "lplc2",                       # looming detectors, giant-fiber input
    "DNp01": "gf",                                         # the giant fiber: escape takeoff
    "DNa01": "dna01", "DNa02": "dna02",                    # steering descending neurons
    "DNp09": "dnp09",                                      # forward walking
    "DNg11": "dng11",                                      # grooming
    "MDN": "mdn",                                          # moonwalker: backward walking
    "DNp02": "escw", "DNp04": "escw", "DNp11": "escw",     # loom-responsive wing/escape DNs
}
# Command populations: each gets its own strongest partners reserved (so no
# descending neuron is left driven by noise alone), in this order, and the
# report shows the synaptic drive each receives inside the circuit.
COMMAND_ROLES = ("gf", "dna01", "dna02", "dnp09", "dng11", "mdn", "escw")
PARTNERS_PER_COMMAND_ROLE = 60
# Slots for the body-to-brain feedback targets.
RESERVED_BY_SUPER_CLASS = (("ascending", 400), ("sensory", 300))

# Sign of a synapse by its predicted transmitter: excitatory, inhibitory, or
# half-strength excitatory for the modulators. Unknown transmitters count as
# excitatory (and are reported).
NT_SIGN = {"ACH": 1.0, "GABA": -1.0, "GLUT": -1.0, "DA": 0.5, "SER": 0.5, "OCT": 0.5}
# The modulator classes are also kept per edge, so the simulation can report
# and target dopaminergic, serotonergic and octopaminergic signalling itself
# rather than as plain excitation; 0 is everything else.
NT_CLASS = {"DA": 1, "SER": 2, "OCT": 3}

# Partners in total. The simulation's cost grows with neurons per millisecond
# and with spikes × out-degree per delivery; the synaptic weights are tuned to
# the edge density this gives (re-tune them when it changes).
MAX_PARTNERS = 6000
MAX_POINTS = 22000

SUPER_CLASSES = ["optic", "central", "sensory", "visual_projection", "visual_centrifugal",
                 "descending", "ascending", "motor", "endocrine"]
EDGE_FORMAT = ("[pre_idx, post_idx, signed_synapse_count, nt_class] — "
               "nt_class: 0=other(ACH/GABA/GLUT/unknown) 1=DA 2=SER 3=OCT")


def table(name):
    """The data rows of one gzipped CSV table (its header skipped)."""
    with gzip.open(os.path.join(RAW_DIR, name), "rt") as handle:
        reader = csv.reader(handle)
        next(reader)
        yield from reader


def strongest_first(strength):
    """Keys by descending strength; equal strengths keep first-seen order."""
    return [key for key, _ in sorted(strength.items(), key=lambda item: -item[1])]


def find_core():
    """root_id -> role and root_id -> cell type for the core populations."""
    role_of, type_of = {}, {}
    found = defaultdict(int)
    for row in table("consolidated_cell_types.csv.gz"):
        root, cell_type = row[0], row[1].strip()
        role = CORE_TYPES.get(cell_type)
        if not role:
            continue
        role_of[root] = role
        type_of[root] = cell_type
        found[cell_type] += 1
    print("core populations:", dict(found))
    if not (found.get("LC4") and found.get("LPLC2") and found.get("DNp01")):
        sys.exit("FATAL: missing a core population — check type names")
    return role_of, type_of


def read_classes_and_positions():
    """root_id -> (super_class, side), and root_id -> soma position (nm) at its first row."""
    classes = {row[0]: (row[2], row[6]) for row in table("classification.csv.gz")}
    positions = {}
    for row in table("coordinates.csv.gz"):
        if row[0] in positions:
            continue
        xyz = row[1].strip("[]").split()
        if len(xyz) == 3:
            positions[row[0]] = tuple(float(v) for v in xyz)
    print(f"classification: {len(classes)}, coordinates: {len(positions)}")
    return classes, positions


def partner_strengths(role_of):
    """Synapses each non-core cell exchanges with the core, in total and per core role."""
    total = defaultdict(int)
    per_role = defaultdict(lambda: defaultdict(int))
    rows_read = 0
    for row in table("connections.csv.gz"):
        rows_read += 1
        pre, post, synapses = row[0], row[1], int(row[3])
        if (pre in role_of) == (post in role_of):
            continue  # core-core or unrelated
        core_cell, partner = (pre, post) if pre in role_of else (post, pre)
        total[partner] += synapses
        per_role[role_of[core_cell]][partner] += synapses
    print(f"connections rows: {rows_read}, candidate partners: {len(total)}")
    return total, per_role


def choose_partners(total, per_role, classes, positions):
    """Reserved partners of each command role, then feedback targets, then the strongest rest."""
    def usable(root):
        return root in positions and root in classes

    chosen, taken = [], set()

    def take(candidates, limit):
        added = 0
        for root in candidates:
            if root in taken or not usable(root):
                continue
            taken.add(root)
            chosen.append(root)
            added += 1
            if added == limit:
                break

    ranked = [root for root in strongest_first(total) if usable(root)]
    for role in COMMAND_ROLES:
        take(strongest_first(per_role[role]), PARTNERS_PER_COMMAND_ROLE)
    for super_class, slots in RESERVED_BY_SUPER_CLASS:
        take([root for root in ranked if classes[root][0] == super_class], slots)
    take(ranked, MAX_PARTNERS - len(chosen))
    print("partner super_classes:", dict(Counter(classes[root][0] for root in chosen)))
    return chosen


def circuit_edges(index_of):
    """Every connection row between two members: (pre, post, signed synapses, nt class)."""
    edges, unknown = [], 0
    per_class = defaultdict(int)
    for row in table("connections.csv.gz"):
        i, j = index_of.get(row[0]), index_of.get(row[1])
        if i is None or j is None:
            continue
        synapses, transmitter = int(row[3]), row[4].strip().upper()
        sign = NT_SIGN.get(transmitter)
        if sign is None:
            sign = 1.0
            unknown += 1
        nt_class = NT_CLASS.get(transmitter, 0)
        per_class[transmitter if nt_class else "other/unknown"] += 1
        edges.append((i, j, round(synapses * sign, 1), nt_class))
    print(f"circuit edges: {len(edges)} (unknown nt on {unknown})")
    print("neuromodulator edge counts:", dict(per_class))
    return edges


def brain_frame(positions):
    """Maps FAFB nm into the view frame: the whole brain centred, its largest extent 20 units.

    FAFB's x runs left-right, y dorsal-ventral (image y points down), z
    anterior-posterior; y and z are flipped.
    """
    lows = [min(p[axis] for p in positions.values()) for axis in range(3)]
    highs = [max(p[axis] for p in positions.values()) for axis in range(3)]
    cx, cy, cz = ((lo + hi) / 2 for lo, hi in zip(lows, highs))
    scale = 20.0 / max(hi - lo for lo, hi in zip(lows, highs))

    def to_view(p):
        return (round((p[0] - cx) * scale, 3), round(-(p[1] - cy) * scale, 3), round(-(p[2] - cz) * scale, 3))
    return to_view


def write_json(name, content):
    with open(os.path.join(DATA_DIR, name), "w") as handle:
        json.dump(content, handle)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    role_of, type_of = find_core()
    classes, positions = read_classes_and_positions()
    total, per_role = partner_strengths(role_of)
    members = list(role_of) + choose_partners(total, per_role, classes, positions)
    index_of = {root: i for i, root in enumerate(members)}
    print(f"circuit members: {len(members)} ({len(role_of)} core + {len(members) - len(role_of)} partners)")
    edges = circuit_edges(index_of)
    to_view = brain_frame(positions)

    # The point cloud: every classified soma, thinned to about MAX_POINTS.
    classified = sorted(root for root in positions if root in classes)
    stride = max(1, len(classified) // MAX_POINTS)
    class_index = {name: i for i, name in enumerate(SUPER_CLASSES)}
    points = [[*to_view(positions[root]), class_index.get(classes[root][0], 1)] for root in classified[::stride]]
    write_json("brain_points.json", {"classes": SUPER_CLASSES, "points": points,
                                     "source": "FlyWire Codex FAFB v783 coordinates.csv + classification.csv"})
    print(f"brain_points.json: {len(points)} points")

    neurons = []
    for root in members:
        super_class, side = classes.get(root, ("", ""))
        where = to_view(positions[root]) if root in positions else (0, 0, 0)
        neurons.append({"id": root, "type": type_of.get(root, super_class or "?"),
                        "role": role_of.get(root, "other"), "side": side, "pos": list(where)})
    write_json("circuit.json", {"neurons": neurons, "edges": edges, "edge_format": EDGE_FORMAT,
                                "source": "FlyWire Codex FAFB v783 connections.csv (syn>=5, signed by nt_type)"})
    print(f"circuit.json: {len(neurons)} neurons, {len(edges)} edges")

    # Report: direct loom -> GF convergence, and the drive onto each command population.
    members_of = defaultdict(set)
    for root, role in role_of.items():
        members_of[role].add(index_of[root])
    looms = members_of["lc4"] | members_of["lplc2"]
    loom_to_gf = [e for e in edges if e[0] in looms and e[1] in members_of["gf"]]
    print(f"sanity: direct loom->GF edges: {len(loom_to_gf)}, total syn: {sum(abs(e[2]) for e in loom_to_gf):.0f}")
    for role in COMMAND_ROLES:
        drive = sum(abs(e[2]) for e in edges if e[1] in members_of[role])
        print(f"  in-circuit drive onto {role}: {drive:.0f} syn")


if __name__ == "__main__":
    main()

"""Build bounded, same-specimen anatomical explorers, not surrogate live animals.

python tools/import-specimens.py [banc-v888|malecns-v1|manc-v1.0|fafb-v783|optic-lobe-v1.1|hemibrain-v1.2|l1em-winding-2023|all]
Requires pyarrow in datasets/tooling (or the Python environment). No pandas.
Source identities are retained as decimal strings; no cross-animal edges.
"""
import csv
import gzip
import hashlib
import importlib.abc
import io
import json
import math
import os
import re
import sys
import tarfile
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
LOCAL_RAW = PROJECT / "datasets"
RAW = Path(os.environ.get("NEUROFLY_DATA_ROOT", LOCAL_RAW))
EXTRA_RAW = Path(os.environ.get("NEUROFLY_RAW_SPECIMENS_ROOT", PROJECT / "raw_specimens"))
OUT = PROJECT / "windows/assets/connectomes"
sys.path.insert(0, str(LOCAL_RAW / "tooling"))
# Arrow's optional pandas shim is unnecessary for these columnar operations.
# The bundled interpreter may contain an unrelated pandas ABI; do not use it.
class NoPandas(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "pandas" or fullname.startswith("pandas."):
            raise ImportError("This importer uses Arrow directly, without pandas")
        return None
sys.meta_path.insert(0, NoPandas())
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather
import pyarrow.ipc as ipc

LIMIT = 6000
CORE = {"LC4", "LPLC2", "DNp01", "DNa01", "DNa02", "DNp09", "MDN", "DNg11", "DNg12", "DNp02", "DNp04", "DNp11"}
PROFILE = {
    "banc-v888": dict(id="banc-v888", name="BANC v888", specimen="BANC", sex="female"),
    "malecns-v1": dict(id="malecns-v1", name="MaleCNS v1.0", specimen="MaleCNS", sex="male"),
    "manc-v1.0": dict(id="manc-v1.0", name="MANC v1.0", specimen="MANC", sex="male"),
    "fafb-v783": dict(id="fafb-v783", name="FlyWire FAFB v783", specimen="FAFB", sex="female"),
    "optic-lobe-v1.1": dict(id="optic-lobe-v1.1", name="Male optic lobe v1.1", specimen="MaleCNS", sex="male", sourceRelease="optic-lobe:v1.1"),
    "hemibrain-v1.2": dict(id="hemibrain-v1.2", name="Hemibrain v1.2", specimen="Hemibrain", sex="female", sourceRelease="hemibrain:v1.2+annotations:v1.2.1"),
    "l1em-winding-2023": dict(id="l1em-winding-2023", name="Larval brain (Winding 2023)", specimen="L1EM", sex="unspecified", sourceRelease="Winding:2023-S1"),
}

HEMIBRAIN_ARCHIVE = "exported-traced-adjacencies-v1.2.tar.gz"
HEMIBRAIN_PREFIX = "exported-traced-adjacencies-v1.2/"


def hemibrain_rows(name):
    """Stream the archived publisher CSV without unpacking a second copy."""
    archive = EXTRA_RAW / "hemibrain-v1.2" / HEMIBRAIN_ARCHIVE
    with tarfile.open(archive, "r:gz") as tar:
        member = tar.getmember(HEMIBRAIN_PREFIX + name)
        if not member.isfile():
            raise ValueError("Missing hemibrain archive member")
        with tar.extractfile(member) as binary, io.TextIOWrapper(binary, encoding="utf-8-sig", newline="") as stream:
            yield from csv.DictReader(stream)


def clean(v):
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (tuple, list)):
        return [clean(x) for x in v]
    return v


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(clean(value), separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    temporary = file.with_suffix(file.suffix + ".partial")
    temporary.write_bytes(raw)
    temporary.replace(file)
    return hashlib.sha256(raw).hexdigest()


def table_rows(file, columns=None):
    return feather.read_table(file, columns=columns).to_pylist()


def csv_rows(file):
    opener = gzip.open if file.suffix == ".gz" else open
    with opener(file, "rt", encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def position(value, factor=1):
    if isinstance(value, str):
        value = re.findall(r"-?\d+(?:\.\d+)?", value)
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    p = [float(x) * factor for x in value]
    return p if all(math.isfinite(x) for x in p) else None


def annotations(profile):
    folder = RAW / profile
    result = {}
    if profile == "banc-v888":
        cols = ["banc_888_id", "root_position_nm", "cell_type", "fafb_cell_type", "super_class", "flow", "side", "nerve", "neuromere", "body_part_effector", "peripheral_target_type", "cell_function", "neurotransmitter_predicted", "neurotransmitter_verified", "neurotransmitter_score", "proofread", "status", "sexually_dimorphic"]
        for row in table_rows(folder / "banc_888_meta.feather", cols):
            rid = row["banc_888_id"]  # root_id is an older materialization, NOT v888!
            pos = position(row["root_position_nm"])
            if not rid:
                continue
            if rid in result:
                raise ValueError(f"Duplicate v888 identity {rid}; resolve annotations before import")
            result[rid] = dict(id=rid, type=row["cell_type"] or "untyped", aliases=row["fafb_cell_type"] or "",
                superClass=row["super_class"] or "unclassified", side=row["side"] or "unknown", pos=pos,
                nt=row["neurotransmitter_verified"] or row["neurotransmitter_predicted"] or "unknown",
                ntEvidence="verified" if row["neurotransmitter_verified"] else "predicted",
                ntConfidence=row["neurotransmitter_score"], annotations=row)
    elif profile == "malecns-v1":
        annotated = table_rows(folder / "body-annotations-male-cns-v1.0-minconf-0.5.feather")
        nt_table = feather.read_table(folder / "body-neurotransmitters-male-cns-v1.0.feather", columns=["body", "consensus_nt", "ground_truth", "predicted_nt_confidence"])
        nt_table = nt_table.filter(pc.is_in(nt_table["body"], value_set=pa.array([r["bodyId"] for r in annotated], type=pa.int64())))
        nt = {str(r["body"]): r for r in nt_table.to_pylist()}
        for row in annotated:
            rid = str(row["bodyId"])
            pos = position(row["somaLocation"], 8) or position(row["tosomaLocation"], 8)
            if rid in result:
                raise ValueError("Duplicate MaleCNS body ID")
            tr = nt.get(rid, {})
            result[rid] = dict(id=rid, type=row["type"] or "untyped", aliases=row["flywireType"] or "",
                superClass=row["superclass"] or "unclassified", side={"L":"left", "R":"right", "M":"center"}.get(row["somaSide"] or row["rootSide"], "unknown"), pos=pos,
                nt=tr.get("consensus_nt") or "unknown", ntEvidence="verified" if tr.get("ground_truth") in {"acetylcholine", "gaba", "glutamate", "dopamine", "serotonin", "octopamine"} else "consensus",
                ntConfidence=tr.get("predicted_nt_confidence"), annotations={k: row.get(k) for k in ["instance", "class", "subclass", "status", "statusLabel", "entryNerve", "exitNerve", "somaNeuromere", "dimorphism", "matchingNotes", "flywireType", "mancType"]})
    elif profile == "manc-v1.0":
        folder = EXTRA_RAW / profile
        traced = {int(r["bodyId"]) for r in csv_rows(folder / "traced-neurons.csv")}
        cols = ["bodyId", "type", "instance", "class", "subclass", "status", "statusLabel", "somaLocation", "rootPosition", "position", "somaSide", "rootSide", "predictedNt", "predictedNtProb", "transmission", "modality", "target", "origin", "entryNerve", "exitNerve", "somaNeuromere", "systematicType"]
        table = feather.read_table(folder / "manc-v1.0-neuron-properties.feather", columns=cols)
        table = table.filter(pc.is_in(table["bodyId"], value_set=pa.array(sorted(traced), type=pa.int64())))
        for row in table.to_pylist():
            rid = str(row["bodyId"])
            if rid in result:
                raise ValueError("Duplicate MANC body ID")
            native = row["somaLocation"] or row["rootPosition"] or row["position"]
            category = (row["class"] or "unclassified").lower().replace(" ", "_")
            result[rid] = dict(id=rid, type=row["type"] or "untyped", aliases=row["systematicType"] or "",
                superClass=category, side={"LHS": "left", "RHS": "right", "L": "left", "R": "right"}.get(row["somaSide"] or row["rootSide"], "unknown"),
                pos=position(native, 8), nt=row["predictedNt"] or "unknown", ntEvidence="predicted",
                ntConfidence=row["predictedNtProb"],
                annotations={k: row.get(k) for k in ["instance", "class", "subclass", "status", "statusLabel", "transmission", "modality", "target", "origin", "entryNerve", "exitNerve", "somaNeuromere"]})
        if set(result) != {str(x) for x in traced}:
            raise ValueError("MANC traced-neuron list does not match v1.0 properties; refusing mixed materializations")
    elif profile == "optic-lobe-v1.1":
        folder = EXTRA_RAW / profile
        cols = ["bodyId:long", "type:string", "instance:string", "status:string",
                "somaLocation:point{srid:9157}", "consensusNt:string", "predictedNtConfidence:float",
                "synweight:int"]
        table = feather.read_table(folder / "Neuprint_Neurons.feather", columns=cols)
        table = table.filter(pc.equal(table["status:string"], "Traced"))
        for row in table.to_pylist():
            rid = str(row["bodyId:long"])
            if rid in result:
                raise ValueError("Duplicate optic-lobe body ID")
            instance = row["instance:string"] or ""
            instance_side = "left" if instance.endswith("_L") else ("right" if instance.endswith("_R") else "unknown")
            result[rid] = dict(id=rid, type=row["type:string"] or "untyped", aliases="",
                superClass="optic-lobe", side=instance_side, pos=position(row["somaLocation:point{srid:9157}"], 8),
                nt=row["consensusNt:string"] or "unknown", ntEvidence="consensus",
                ntConfidence=row["predictedNtConfidence:float"],
                annotations={"instance": row["instance:string"], "instanceSideBasis": "instance suffix; not verified soma hemisphere", "status": row["status:string"],
                             "sourceSynweight": row["synweight:int"]})
    elif profile == "hemibrain-v1.2":
        folder = EXTRA_RAW / profile
        traced = {r["bodyId"]: r for r in hemibrain_rows("traced-neurons.csv")}
        meta = {r["bodyId"]: r for r in csv_rows(folder / "Supplemental_file5_hemibrain_meta.csv") if r.get("bodyId") in traced}
        ids = pa.array([int(x) for x in traced], type=pa.uint64())
        nt_table = feather.read_table(folder / "hemibrain-v1.2-body-mean-neurotransmitters.feather")
        nt_table = nt_table.filter(pc.is_in(nt_table["body"], value_set=ids))
        nt = {str(r["body"]): r for r in nt_table.to_pylist()}
        for rid, original in traced.items():
            supplement, tr = meta.get(rid, {}), nt.get(rid, {})
            transmitter = tr.get("predicted_nt") or "unknown"
            if transmitter == "neither":
                transmitter = "unknown"
            confidence = tr.get(transmitter)
            result[rid] = dict(id=rid, type=original["type"] or "untyped", aliases="",
                superClass=supplement.get("cell_class") or "unclassified",
                side=supplement.get("side") or "unknown",
                pos=position(supplement.get("somaLocation"), 8), nt=transmitter,
                ntEvidence="predicted" if transmitter != "unknown" else "unknown", ntConfidence=confidence,
                annotations={"instance": original["instance"], "cellClass": supplement.get("cell_class"),
                    "hemilineage": supplement.get("ito_lee_hemilineage"), "fbbtId": supplement.get("fbbt_id"),
                    "supplementaryAnnotationRelease": "hemibrain:v1.2.1" if supplement else None,
                    "supplementaryType": supplement.get("type") if supplement and supplement.get("type") != original["type"] else None})
    else:
        types = {r["root_id"]: r for r in csv_rows(folder / "consolidated_cell_types.csv.gz")}
        coords = {}
        for r in csv_rows(folder / "coordinates.csv.gz"):
            coords.setdefault(r["root_id"], position(r["position"]))
        nt = {r["root_id"]: r for r in csv_rows(folder / "neurons.csv.gz")}
        stats = {r["root_id"]: r for r in csv_rows(folder / "cell_stats.csv.gz")}
        visual = {r["root_id"]: r for r in csv_rows(folder / "visual_neuron_types.csv.gz")}
        for r in csv_rows(folder / "classification.csv.gz"):
            rid = r["root_id"]
            if not coords.get(rid):
                continue
            tr = nt.get(rid, {})
            result[rid] = dict(id=rid, type=types.get(rid, {}).get("primary_type") or "untyped", aliases="",
                superClass=r["super_class"], side=r["side"] or "unknown", pos=coords[rid],
                nt={"ACH":"acetylcholine", "GABA":"gaba", "GLUT":"glutamate", "DA":"dopamine", "SER":"serotonin", "OCT":"octopamine"}.get(tr.get("nt_type"), "unknown"),
                ntConfidence=float(tr["nt_type_score"]) if tr.get("nt_type_score") else None, ntEvidence="predicted",
                annotations={**r, "morphometrics": stats.get(rid), "visualType": visual.get(rid)})
    print(profile, "annotated records", len(result), "with position", sum(bool(n["pos"]) for n in result.values()), flush=True)
    return result


def edge_batches(profile, endpoints=None):
    """Filter in Arrow before Python conversion; keep 64-bit IDs exact."""
    if profile == "hemibrain-v1.2":
        rows = []
        for r in hemibrain_rows("traced-total-connections.csv"):
            pre, post = r["bodyId_pre"], r["bodyId_post"]
            if endpoints is None or pre in endpoints or post in endpoints:
                rows.append((pre, post, int(r["weight"])))
            if len(rows) >= 50000:
                yield rows
                rows = []
        if rows:
            yield rows
        return
    if profile == "manc-v1.0":
        rows = []
        # The per-ROI CSV partitions these same synapses; summing it here
        # would double-count. The duplicate traced-connections2 is unused.
        for r in csv_rows(EXTRA_RAW / profile / "traced-connections.csv"):
            pre, post = r["bodyId_pre"], r["bodyId_post"]
            if endpoints is None or pre in endpoints or post in endpoints:
                rows.append((pre, post, int(r["weight"])))
            if len(rows) >= 50000:
                yield rows
                rows = []
        if rows:
            yield rows
        return
    if profile == "fafb-v783":
        rows = []
        file = RAW / profile / "connections_princeton_no_threshold (1).csv.gz"
        for r in csv_rows(file):
            pre, post = r["pre_root_id"], r["post_root_id"]
            if endpoints is None or pre in endpoints or post in endpoints:
                rows.append((pre, post, int(r["syn_count"])))
            if len(rows) >= 50000:
                yield rows
                rows = []
        if rows:
            yield rows
        return
    if profile == "banc-v888":
        file = RAW / profile / "banc_888_edgelist_simple_v3.feather"
        keys = ("pre", "post", "count")
        ids = pa.array(sorted(endpoints), type=pa.string()) if endpoints else None
    else:
        file = (EXTRA_RAW / profile / "connectome-weights-2024-09-11-a7d912-minconf-0.5-ol.feather"
                if profile == "optic-lobe-v1.1" else RAW / profile / "connectome-weights-male-cns-v1.0-minconf-0.5.feather")
        keys = ("body_pre", "body_post", "weight")
        ids = pa.array(sorted(int(x) for x in endpoints), type=pa.int64()) if endpoints else None
    with pa.memory_map(str(file), "r") as source:
        reader = ipc.open_file(source)
        for i in range(reader.num_record_batches):
            batch = reader.get_batch(i)
            if ids is not None:
                mask = pc.or_(pc.is_in(batch[keys[0]], value_set=ids), pc.is_in(batch[keys[1]], value_set=ids))
                batch = batch.filter(mask)
            yield zip(*(batch[k].to_pylist() for k in keys))


def extract_larval():
    """Import the small original supplemental matrix without inventing locations."""
    folder = EXTRA_RAW / "l1em-winding-2023"
    manifest = json.loads((folder / "MANIFEST.json").read_text("utf-8"))
    archive = folder / "Supplementary-Data-S1.zip"
    if manifest["name"] != archive.name or manifest["sourceStudy"] != "Winding et al., Science 2023, doi:10.1126/science.add9330":
        raise ValueError("Unrecognized larval source archive")
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != manifest["sha256"]:
            raise ValueError("Larval archive checksum changed")
    with zipfile.ZipFile(archive) as z:
        root = "Supplementary-Data-S1/"
        with z.open(root + "annotations.csv") as source:
            rows = list(csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig", newline="")))
        ann = {}
        for row in rows:
            for column, side in [("left_id", "left"), ("right_id", "right")]:
                rid = row[column]
                if not rid.isdecimal():
                    continue
                if rid in ann:
                    raise ValueError("Duplicate larval annotation ID")
                ann[rid] = dict(type=row["celltype"] or "untyped", side=side,
                    annotations={"additionalAnnotations": row["additional_annotations"], "level7Cluster": row["level_7_cluster"],
                                 "pairAnnotation": "paired" if row["left_id"].isdecimal() and row["right_id"].isdecimal() else "unpaired"})
        with z.open(root + "all-all_connectivity_matrix.csv") as source:
            table = csv.reader(io.TextIOWrapper(source, encoding="utf-8-sig", newline=""))
            header = next(table)
            ids = header[1:]
            if len(ids) != 2952 or len(set(ids)) != len(ids) or not all(x.isdecimal() for x in ids):
                raise ValueError("Unexpected larval matrix neuron identities")
            incoming, outgoing, edges = Counter(), Counter(), []
            row_index = -1
            for row_index, row in enumerate(table):
                if row_index >= len(ids) or row[0] != ids[row_index] or len(row) != len(header):
                    raise ValueError("Larval matrix row/column identities differ")
                for column_index, raw in enumerate(row[1:]):
                    value = float(raw)
                    if not math.isfinite(value) or value < 0 or not value.is_integer():
                        raise ValueError("Larval matrix has non-integer or invalid contact count")
                    count = int(value)
                    if count:
                        edges.append([row_index, column_index, count])
                        outgoing[row_index] += count
                        incoming[column_index] += count
            if row_index + 1 != len(ids) or not edges:
                raise ValueError("Larval matrix is incomplete")
    neurons = []
    for i, rid in enumerate(ids):
        a = ann.get(rid, {})
        neurons.append(dict(id=rid, specimen="L1EM", type=a.get("type", "untyped"), aliases="",
            superClass=a.get("type", "unclassified"), side=a.get("side", "unknown"),
            pos=None, posNm=None, positionKnown=False, nt="unknown", ntEvidence="not-published-in-this-archive",
            ntConfidence=None, annotations=a.get("annotations", {}), seed=False,
            fullInputContacts=incoming[i], fullOutputContacts=outgoing[i]))
    summary = dict(annotatedRecords=len(ann), annotatedRecordsWithPosition=0, unlocatedSelected=len(ids),
        selectedNeurons=len(ids), selectedConnections=len(edges), selectedContacts=sum(x[2] for x in edges),
        seedNeurons=0, classes=dict(Counter(n["superClass"] for n in neurons)), unknownTransmitters=len(ids),
        edgeThreshold=1, fullMatrix=True)
    bundle = dict(schema=1, profile=PROFILE["l1em-winding-2023"], neurons=neurons, edges=edges, summary=summary,
        sources=[dict(name=archive.name, bytes=manifest["bytes"], sha256=manifest["sha256"], source=manifest["source"],
            license="verify-before-redistribution", checksumBasis="pinned-Git-blob-SHA1-and-local-SHA256")],
        coordinateSpace="No measured cell coordinates in this supplementary archive",
        positionMeaning="No positions supplied; all cells deliberately remain unlocated. Do not interpret a graph layout as anatomical geometry.",
        selection="All 2952 matrix cells; all-all directed contacts >=1. The axon/dendrite matrices are alternate partitions, not added to this total. Source counts, not the paper's whole-specimen counts.",
        runtimeReady=False, excludedFromRuntime="Larval CNS and adult body physiology are not integrated; anatomy and development differ.")
    digest = write_json(OUT / "l1em-winding-2023.json", bundle)
    print("l1em-winding-2023 DONE", summary, flush=True)
    return dict(id="l1em-winding-2023", **summary, sha256=digest, runtimeReady=False)


def extract(profile):
    if profile == "l1em-winding-2023":
        return extract_larval()
    ann = annotations(profile)
    if profile == "optic-lobe-v1.1":
        # The source is a visual-system subset, not a motor circuit. Keep one
        # located, typed representative per published type before filling by
        # source synaptic weight. This is display sampling, not physiology.
        ranked = sorted((rid for rid, n in ann.items() if n["pos"] is not None),
            key=lambda rid: (-int(ann[rid]["annotations"]["sourceSynweight"] or 0), int(rid)))
        representative = {}
        for rid in ranked:
            kind = ann[rid]["type"]
            if kind != "untyped" and kind not in representative:
                representative[kind] = rid
        seeds = set(representative.values())
        if len(seeds) > LIMIT:
            raise ValueError("More optic-lobe types than the display limit; revise sampling")
        chosen = set(seeds)
        for rid in ranked:
            if len(chosen) >= LIMIT:
                break
            chosen.add(rid)
    elif profile == "hemibrain-v1.2":
        seeds = {rid for rid, n in ann.items() if n["type"] in CORE or n["type"].startswith(("MBON", "PAM", "PPL", "APL", "DPM"))}
        if not seeds or len(seeds) > LIMIT:
            raise ValueError("Unexpected hemibrain circuit seed count")
        strength = Counter()
        for batch in edge_batches(profile, seeds):
            for pre, post, count in batch:
                if pre in seeds and post in ann and post not in seeds:
                    strength[post] += count
                if post in seeds and pre in ann and pre not in seeds:
                    strength[pre] += count
        chosen = set(seeds)
        for rid in sorted(strength, key=lambda x: (-strength[x], int(x))):
            if len(chosen) >= LIMIT:
                break
            chosen.add(rid)
    else:
        seeds = {rid for rid, n in ann.items() if n["type"] in CORE or n["aliases"] in CORE or "motor" in n["superClass"] or n["superClass"] in ("descending", "descending_neuron")}
        if not seeds or len(seeds) > LIMIT:
            raise ValueError(f"Unexpected seed count {len(seeds)}; review schema")
        strength = Counter()
        for batch in edge_batches(profile, seeds):
            for pre, post, count in batch:
                pre, post = str(pre), str(post)
                if pre in seeds and post in ann and post not in seeds:
                    strength[post] += count
                if post in seeds and pre in ann and pre not in seeds:
                    strength[pre] += count
        ranked = sorted(strength, key=lambda x: (-strength[x], int(x)))
        chosen = set(seeds)
        # These are sampling quotas, not physiology.
        for category, limit in [("sensory", 350), ("vnc", 1000), ("ascending", 200)]:
            added = 0
            for rid in ranked:
                category_match = category in ann[rid]["superClass"] or (category == "vnc" and ann[rid]["superClass"] == "ventral_nerve_cord_intrinsic")
                if category_match and rid not in chosen and len(chosen) < LIMIT:
                    chosen.add(rid)
                    added += 1
                    if added >= limit:
                        break
        for rid in ranked:
            if len(chosen) >= LIMIT:
                break
            chosen.add(rid)
    ids = sorted(chosen, key=int)
    if profile == "optic-lobe-v1.1":
        male_file = RAW / "malecns-v1/body-annotations-male-cns-v1.0-minconf-0.5.feather"
        if not male_file.exists():
            raise ValueError("MaleCNS annotation file is required to verify overlapping optic-lobe IDs")
        male_ids = set(feather.read_table(male_file, columns=["bodyId"])["bodyId"].to_pylist())
        if any(int(rid) not in male_ids for rid in ids):
            raise ValueError("Optic-lobe selection contains IDs absent from MaleCNS; do not assert common identity")
    index = {rid: i for i, rid in enumerate(ids)}
    metric_rows = 0
    reviewed_rows = 0
    reviewed_unresolvable = 0
    reviewed_sources = []
    if profile == "banc-v888":
        metric_file = RAW / profile / "banc_888_metrics.feather"
        online = json.loads((RAW / "inventory-online.json").read_text("utf-8"))
        recorded = next((f for f in online["files"] if f["dataset"] == profile and f["name"] == metric_file.name and f["status"] == "verified"), None)
        if not recorded or metric_file.stat().st_size != recorded["bytes"]:
            raise ValueError("BANC v888 metric source is missing or differs in size")
        with metric_file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != recorded["sha256"]:
                raise ValueError("BANC v888 metric source checksum changed")
        metric_table = feather.read_table(metric_file)
        metric_table = metric_table.filter(pc.is_in(metric_table["banc_888_id"], value_set=pa.array(ids, type=pa.string())))
        by_cell = defaultdict(list)
        for row in metric_table.to_pylist():
            rid = row.pop("banc_888_id")
            by_cell[rid].append(row)
            metric_rows += 1
        for rid in ids:
            ann[rid]["annotations"]["morphometricsByRegion"] = by_cell.get(rid, [])
            ann[rid]["annotations"]["morphometricsBasis"] = "BANC v888 publisher metrics; each region row retained, not summed. Cable length in µm, volume in nm³; no physiological latency inferred."
        review_manifest = json.loads((EXTRA_RAW / profile / "reviewed-matches-manifest.json").read_text("utf-8"))
        targets = {"fafb": "FAFB", "fanc": "FANC", "hemibrain": "Hemibrain", "malecns": "MaleCNS", "manc": "MANC", "mirror": "BANC"}
        if review_manifest.get("verification") != "publisher-MD5-plus-local-SHA256" or len(review_manifest.get("files", [])) != len(targets):
            raise ValueError("Incomplete BANC publisher-reviewed correspondence manifest")
        for label, specimen in targets.items():
            name = f"banc_{label}_reviewed_matches.csv.gz"
            record = next((r for r in review_manifest["files"] if r["name"] == name), None)
            if not record:
                raise ValueError(f"Missing BANC reviewed-match file {name}")
            file = EXTRA_RAW / profile / name
            if file.stat().st_size != record["bytes"]:
                raise ValueError(f"BANC reviewed-match source size changed: {name}")
            with file.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != record["sha256"]:
                    raise ValueError(f"BANC reviewed-match source checksum changed: {name}")
            with file.open("rb") as stream:
                if hashlib.file_digest(stream, "md5").hexdigest() != record["md5"]:
                    raise ValueError(f"BANC publisher MD5 mismatch: {name}")
            opener = gzip.open if record["encoding"] == "gzip" else open
            with opener(file, "rt", encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream)
                needed = {"pt_root_id", "valid", "match_root_id" if label == "mirror" else "match_id"}
                if not needed.issubset(reader.fieldnames or []):
                    raise ValueError(f"BANC reviewed-match columns changed: {name}")
                for row in reader:
                    if row["valid"] not in ("t", "f"):
                        raise ValueError(f"Unrecognized BANC review flag: {name}")
                    rid = row["pt_root_id"]  # publisher-documented BANC v888 identity; query_id is not it
                    if row["valid"] != "t" or rid not in chosen:
                        continue
                    target = row["match_root_id" if label == "mirror" else "match_id"]
                    if not target.isdecimal():
                        # Publisher `valid=t` can still carry `NA`, a named
                        # draft object or a multi-hit string: none is an
                        # exact target-neuron ID for this explorer.
                        reviewed_unresolvable += 1
                        continue
                    ann[rid]["annotations"].setdefault("reviewedCorrespondences", []).append(dict(
                        targetSpecimen=specimen, targetId=target,
                        targetType=row.get("match_cell_type") or None,
                        relation="within-specimen-mirror" if label == "mirror" else "cross-specimen-reviewed-correspondence",
                        source=name, versionResolved=False))
                    reviewed_rows += 1
            reviewed_sources.append(dict(name=name, sha256=record["sha256"], bytes=record["bytes"],
                source=record["url"], license=record["license"], checksumBasis="publisher-MD5-and-local-SHA256"))
    full_in, full_out, retained = Counter(), Counter(), Counter()
    print(profile, "selected", len(ids), "including", len(seeds), "native seeds", flush=True)
    for batch in edge_batches(profile, chosen):
        for pre, post, count in batch:
            pre, post, count = str(pre), str(post), int(count)
            if count <= 0:
                raise ValueError("Nonpositive source contact count")
            if pre in chosen:
                full_out[pre] += count
            if post in chosen:
                full_in[post] += count
            if pre in chosen and post in chosen:
                retained[(index[pre], index[post])] += count
    edges = [[pre, post, n] for (pre, post), n in sorted(retained.items()) if n >= 5]
    if not edges:
        raise ValueError("No native edges matched IDs; do not mix materializations")
    located = [n for n in ann.values() if n["pos"] is not None]
    centres = [(min(n["pos"][i] for n in located) + max(n["pos"][i] for n in located)) / 2 for i in range(3)]
    scale = 20 / max(max(n["pos"][i] for n in located) - min(n["pos"][i] for n in located) for i in range(3))
    neurons = []
    for rid in ids:
        n = ann[rid]
        neurons.append({**n, "specimen": PROFILE[profile]["specimen"], "posNm": n["pos"],
            "positionKnown": n["pos"] is not None,
            "pos": [round((n["pos"][i] - centres[i]) * scale * (1 if i == 0 else -1), 5) for i in range(3)] if n["pos"] else None,
            "seed": rid in seeds, "fullInputContacts": full_in[rid], "fullOutputContacts": full_out[rid]})
    sources = []
    for inventory_file in [RAW / "inventory-online.json", RAW / "inventory-local.json"]:
        if inventory_file.exists():
            for entry in json.loads(inventory_file.read_text("utf-8"))["files"]:
                if entry["dataset"] == profile and entry["status"] == "verified":
                    sources.append({k: entry[k] for k in ["name", "sha256", "bytes", "source", "license"]})
    sources.extend(reviewed_sources)
    if profile in ("manc-v1.0", "optic-lobe-v1.1", "hemibrain-v1.2"):
        audit = json.loads((OUT / "raw-source-audit.json").read_text("utf-8"))
        if audit.get("checksumBasis") != "previously-recorded-local-sha256" or audit.get("publisherAuthenticated") is not False:
            raise ValueError("Raw-source audit provenance changed")
        checked = next(d for d in audit["datasets"] if d["id"] == profile)
        needed = ({"manc-v1.0-neuron-properties.feather", "traced-neurons.csv", "traced-connections.csv"}
                  if profile == "manc-v1.0" else ({"Neuprint_Neurons.feather", "connectome-weights-2024-09-11-a7d912-minconf-0.5-ol.feather"}
                  if profile == "optic-lobe-v1.1" else {HEMIBRAIN_ARCHIVE, "hemibrain-v1.2-body-mean-neurotransmitters.feather"}))
        for f in checked["files"]:
            if f["name"] in needed and f["status"] == "verified":
                local = EXTRA_RAW / profile / f["name"]
                if local.stat().st_size != f["bytes"]:
                    raise ValueError(f"Source size changed: {f['name']}")
                with local.open("rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != f["sha256"]:
                        raise ValueError(f"Source checksum changed: {f['name']}")
                sources.append(dict(name=f["name"], sha256=f["sha256"], bytes=f["bytes"], source=f["url"],
                    license="verify-before-redistribution" if profile == "hemibrain-v1.2" else "CC-BY-4.0", checksumBasis="previously-recorded-local-sha256"))
        if {f["name"] for f in sources} != needed:
            raise ValueError("Source audit is incomplete")
        if profile == "hemibrain-v1.2":
            m = json.loads((EXTRA_RAW / profile / "supplementary-annotations.json").read_text("utf-8"))
            file = EXTRA_RAW / profile / m["name"]
            if m["name"] != "Supplemental_file5_hemibrain_meta.csv" or file.stat().st_size != m["bytes"]:
                raise ValueError("Hemibrain supplementary annotation identity changed")
            with file.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != m["sha256"]:
                    raise ValueError("Hemibrain supplementary annotation checksum changed")
            sources.append(dict(name=m["name"], sha256=m["sha256"], bytes=m["bytes"], source=m["source"],
                license="verify-before-redistribution", sourceRelease=m["sourceRelease"], checksumBasis="pinned-Git-blob-SHA1-and-local-SHA256"))
    summary = dict(annotatedRecords=len(ann), annotatedRecordsWithPosition=len(located), unlocatedSelected=sum(n["pos"] is None for n in neurons), selectedNeurons=len(neurons), selectedConnections=len(edges),
        selectedContacts=sum(e[2] for e in edges), seedNeurons=len(seeds), classes=dict(Counter(n["superClass"] for n in neurons)),
        unknownTransmitters=sum(n["nt"] == "unknown" for n in neurons), edgeThreshold=5,
        sameSampleIdOverlapVerified=len(ids) if profile == "optic-lobe-v1.1" else None,
        selectedMorphometricRows=metric_rows if profile == "banc-v888" else None,
        selectedReviewedCorrespondences=reviewed_rows if profile == "banc-v888" else None,
        reviewedRowsWithoutExactTargetId=reviewed_unresolvable if profile == "banc-v888" else None)
    bundle = dict(schema=1, profile=PROFILE[profile], neurons=neurons, edges=edges, summary=summary, sources=sources,
        coordinateSpace=f"{PROFILE[profile]['specimen']} native EM, nanometres",
        positionMeaning="published soma points, 8-nm voxels converted to nm" if profile == "optic-lobe-v1.1" else ("supplementary v1.2.1 soma points matched by exact body ID to v1.2 traced cells; 8-nm voxels converted to nm" if profile == "hemibrain-v1.2" else ("published soma/root/representative points, 8-nm voxels converted to nm" if profile == "manc-v1.0" else ("published representative/root points; not uniformly somata" if profile != "malecns-v1" else "published soma/tosoma points, 8-nm voxels converted to nm"))),
        selection=("One located traced representative per named type, then highest source synaptic weight to 6000 cells; induced pairs >=5 contacts. Same biological MaleCNS sample, distinct optic-lobe:v1.1 release; do not add duplicate/overlapping edges to male-cns:v1.0. Not a runtime."
            if profile == "optic-lobe-v1.1" else ("Native motor and descending cells plus named command cells; strongest contacting partners and sensory/ascending quotas; maximum 6000 cells; induced pairs >=5 contacts. MANC nerve-cord subset, not a full CNS or runtime."
            if profile == "manc-v1.0" else ("v1.2 traced cells: MBON, PAM/PPL, APL, DPM and named command/visual seeds plus strongest contacting partners; max 6000 cells, induced pairs >=5 contacts. Supplementary v1.2.1 positions are exact-ID matches, not connectivity substitution. Partial brain only."
            if profile == "hemibrain-v1.2" else "Native motor and descending cells plus named LC4/LPLC2/command cells; strongest contacting partners, sensory/VNC/ascending quotas; maximum 6000 cells; induced connections >=5 contacts. Not a whole-CNS simulation."))),
        runtimeReady=False, excludedFromRuntime="Native body/sensory mapping and physiological validation pending. Anatomy browser only; existing terrarium is unchanged.")
    digest = write_json(OUT / f"{profile}.json", bundle)
    print(profile, "DONE", summary, flush=True)
    return dict(id=profile, **summary, sha256=digest, runtimeReady=False)


def morphology():
    archive = RAW / "fafb-v783/sk_lod1_783_healed.zip"
    if not archive.exists():
        return None
    circuit = json.loads((PROJECT / "data/circuit.json").read_text("utf-8"))
    wanted = {n["id"] for n in circuit["neurons"] if n["type"] in CORE - {"LC4", "LPLC2"}}
    result = {}
    with zipfile.ZipFile(archive) as z:
        entries = {f.filename: f for f in z.infolist()}
        for rid in sorted(wanted):
            name = f"{rid}.swc"
            if name not in entries or entries[name].file_size > 30 * 1024 ** 2:
                continue
            raw = z.read(name)  # verifies CRC for every imported skeleton
            nodes = {}
            for line in raw.decode("utf-8").splitlines():
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                p = line.split()
                if len(p) != 7:
                    raise ValueError(f"Invalid SWC: {name}")
                if int(p[0]) in nodes:
                    raise ValueError(f"Duplicate SWC node: {name}")
                nodes[int(p[0])] = (float(p[2]), float(p[3]), float(p[4]), int(p[6]))
            segments, length, branches = [], 0, Counter()
            for node in nodes.values():
                parent = nodes.get(node[3])
                if node[3] >= 0 and parent is None:
                    raise ValueError(f"Missing SWC parent: {name}")
                if parent:
                    segment = list(node[:3]) + list(parent[:3])
                    if not all(math.isfinite(v) for v in segment):
                        raise ValueError("Nonfinite morphology coordinate")
                    length += math.dist(node[:3], parent[:3])
                    branches[node[3]] += 1
                    if len(segments) < 30000:
                        segments.append(segment)
            neuron = dict(id=rid, specimen="FAFB", units="nm", segments=segments, points=len(nodes),
                cableLengthNm=length, branchPoints=sum(v > 1 for v in branches.values()),
                displayedSegments=len(segments), totalSegments=sum(branches.values()),
                truncated=sum(branches.values()) > len(segments), sha256=hashlib.sha256(raw).hexdigest())
            result[rid] = dict(sha256=write_json(OUT / "morphology" / f"{rid}.json", neuron))
        summary = dict(archiveEntries=len(entries), archiveUncompressedBytes=sum(e.file_size for e in entries.values()),
            importedSkeletons=len(result), verification="ZIP directory read; imported entries CRC-checked; rest of archive not decompressed")
    digest = write_json(OUT / "fafb-morphology.json", dict(schema=2, specimen="FAFB", neurons=result, summary=summary))
    return {**summary, "sha256": digest}


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode not in [*PROFILE, "all", "morphology", "catalog"]:
        raise SystemExit("Unknown dataset")
    catalog_file = OUT / "catalog.json"
    catalog = json.loads(catalog_file.read_text("utf-8")) if catalog_file.exists() else dict(schema=1, profiles=[])
    for profile in PROFILE if mode == "all" else ([mode] if mode in PROFILE else []):
        entry = extract(profile)
        catalog["profiles"] = [p for p in catalog["profiles"] if p["id"] != profile] + [entry]
        write_json(catalog_file, catalog)
    if mode in ("all", "morphology"):
        catalog["morphology"] = morphology()
    # Reconstruct the catalog from complete bundles, also making separately
    # run imports composable. Never infer runtime readiness from file presence.
    catalog["profiles"] = []
    for profile in PROFILE:
        file = OUT / f"{profile}.json"
        if file.exists():
            raw = file.read_bytes()
            data = json.loads(raw)
            if data["profile"]["id"] != profile:
                raise ValueError("Catalog rebuild found an incorrectly named specimen")
            catalog["profiles"].append(dict(id=profile, **data["summary"], sha256=hashlib.sha256(raw).hexdigest(), runtimeReady=False))
    morphology_file = OUT / "fafb-morphology.json"
    if morphology_file.exists():
        raw = morphology_file.read_bytes()
        m = json.loads(raw)
        catalog["morphology"] = {**m["summary"], "sha256": hashlib.sha256(raw).hexdigest()}
    catalog["files"] = []
    for file in [RAW / "inventory-online.json", RAW / "inventory-local.json"]:
        if file.exists():
            for entry in json.loads(file.read_text("utf-8"))["files"]:
                catalog["files"].append({k: entry.get(k) for k in ["dataset", "name", "bytes", "sha256", "status", "error", "license", "source"]})
    for profile, filename in [("hemibrain-v1.2", "supplementary-annotations.json"),
                              ("l1em-winding-2023", "MANIFEST.json")]:
        manifest = EXTRA_RAW / profile / filename
        if manifest.exists():
            m = json.loads(manifest.read_text("utf-8"))
            catalog["files"].append(dict(dataset=profile, name=m["name"], bytes=m["bytes"],
                sha256=m["sha256"], status="verified" if any(p["id"] == profile for p in catalog["profiles"]) else "archived",
                error=None, license="verify-before-redistribution", source=m["source"]))
    review_manifest = EXTRA_RAW / "banc-v888" / "reviewed-matches-manifest.json"
    if review_manifest.exists():
        for m in json.loads(review_manifest.read_text("utf-8"))["files"]:
            catalog["files"].append(dict(dataset="banc-v888", name=m["name"], bytes=m["bytes"],
                sha256=m["sha256"], status="verified", error=None, license=m["license"], source=m["url"]))
    catalog["checkedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(catalog_file, catalog)

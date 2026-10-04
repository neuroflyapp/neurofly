#!/usr/bin/env python3
"""BANC v888 (female brain and nerve cord of one animal) in the shape of the
MaleCNS tables, so the same, tested extraction code builds a female fly:
etl_malecns_brain.py for its brain and etl_malecns.py for its leg circuit.

Nothing is invented: every field is a BANC annotation, renamed into the
MaleCNS vocabulary (superclass names, leg subclasses fl/ml/hl, leg nerves
ProLN/MesoLN/MetaLN, proprioceptor subclasses, MANC motor-neuron type names
from BANC's own manc_cell_type, FlyWire types from fafb_cell_type). Weights are
BANC's whole-cell edge counts; transmitters BANC's predictions.

Usage: python etl_banc_adapter.py raw_specimens/banc-v888 raw_banc_as_malecns
Writes the three Feather tables etl_malecns.py and etl_malecns_brain.py read,
and source.json: BANC's own files (SHA-256) and notes both scripts record as
their provenance. The female bundle (data/female/) is then:
  python etl_malecns_brain.py raw_banc_as_malecns female "BANC v888"
  python etl_malecns.py raw_banc_as_malecns --out data/female
  node windows/tools/derive-rhythm-decoder.mjs female
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else "raw_specimens/banc-v888")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "raw_banc_as_malecns")
DOWNLOAD = "https://doi.org/10.7910/DVN/7WTH1N"
NAMES = dict(annotations="body-annotations-male-cns-v1.0-minconf-0.5.feather",
             neurotransmitters="body-neurotransmitters-male-cns-v1.0.feather",
             weights="connectome-weights-male-cns-v1.0-minconf-0.5.feather")

SUPER = {  # (BANC super_class, region) -> MaleCNS superclass
    "central_brain_intrinsic": "cb_intrinsic", "optic_lobe_intrinsic": "ol_intrinsic",
    "visual_projection": "visual_projection", "visual_centrifugal": "visual_centrifugal",
    "descending": "descending_neuron", "ascending": "ascending_neuron", "sensory_ascending": "sensory_ascending",
    "ventral_nerve_cord_intrinsic": "vnc_intrinsic", "sensory_descending": "sensory_descending",
}
LEG = {"front_leg": "fl", "middle_leg": "ml", "hind_leg": "hl"}
LEG_NERVE = {"front_leg": "ProLN", "middle_leg": "MesoLN", "hind_leg": "MetaLN"}
PROPRIO = {"chordotonal_organ_neuron": "chordotonal organ", "campaniform_sensillum_neuron": "campaniform sensilla",
           "hair_plate_neuron": "hair plate"}
SIDE = {"left": "L", "right": "R", "center": "M"}
# BANC leg muscle (peripheral_target_type) -> the MANC motor type the cord
# extraction reads as that muscle's channel. Both trochanter extensors
# (trochanter_extensor, sternotrochanter_extensor) extend the trochanter; the
# tergotrochanter (in T2 the jump muscle) and the femur reductor, tarsus and
# long-tendon muscles are outside the model's channels, as for MaleCNS.
MUSCLE_TYPE = {
    "tibia_flexor_muscle": "Ti flexor MN", "accessory_tibia_flexor_muscle": "Acc. ti flexor MN",
    "tibia_extensor_muscle": "Ti extensor MN",
    "trochanter_flexor_muscle": "Tr flexor MN", "accessory_trochanter_flexor_muscle": "Acc. tr flexor MN",
    "trochanter_extensor_muscle": "Tr extensor MN", "sternotrochanter_extensor_muscle": "Tr extensor MN",
    "tergopleural_promotor_muscle": "Tergopleural/Pleural promotor MN",
    "pleural_remotor_and_abductor_muscle": "Pleural remotor/abductor MN",
    "sternal_anterior_rotator_muscle": "Sternal anterior rotator MN",
    "sternal_posterior_rotator_muscle": "Sternal posterior rotator MN",
}


def xyz(value):
    try:
        parts = [float(v) for v in str(value).replace("[", "").replace("]", "").split(",")]
        return np.array(parts, dtype=np.float64) if len(parts) == 3 else None
    except ValueError:
        return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = feather.read_table(RAW / "banc_888_meta.feather").to_pandas()
    meta = meta.drop_duplicates("banc_888_id")
    body = meta["banc_888_id"].astype("int64")
    region = meta["region"].astype(str)
    sc = meta["super_class"].astype(str)

    superclass = sc.map(SUPER)
    superclass[(sc == "sensory") & (region == "ventral_nerve_cord")] = "vnc_sensory"
    superclass[(sc == "sensory") & (region == "optic_lobe")] = "ol_sensory"
    superclass[(sc == "sensory") & (region == "central_brain")] = "cb_sensory"
    superclass[(sc == "motor") & (region == "ventral_nerve_cord")] = "vnc_motor"
    superclass[(sc == "motor") & (region != "ventral_nerve_cord")] = "cb_motor"
    superclass[sc.isin(["visceral_circulatory", "ascending_visceral_circulatory"]) & (region != "ventral_nerve_cord")] = "cb_endocrine"

    is_mn = superclass == "vnc_motor"
    is_proprio = (superclass == "vnc_sensory") & meta["cell_class"].isin(PROPRIO)
    cell_type = meta["cell_type"].where(meta["cell_type"].notna(), None)
    mtype = cell_type.copy()
    # A leg motor neuron's channel comes from BANC's own muscle annotation,
    # written as the MANC type name the cord extraction maps to that channel.
    # Muscles outside the model's channels keep a name that matches none.
    muscle = meta.loc[is_mn, "peripheral_target_type"].astype(str)
    mtype[is_mn] = [MUSCLE_TYPE.get(m, f"other leg MN ({m})") for m in muscle]
    cls = meta["cell_class"].astype(object).copy()
    cls[is_proprio] = "mechanosensory_proprioceptive"
    sub = meta["cell_sub_class"].astype(object).copy()
    sub[is_mn] = meta.loc[is_mn, "body_part_effector"].map(LEG)
    sub[is_proprio] = meta.loc[is_proprio, "cell_class"].map(PROPRIO)
    # FlyWire's own classes for the senses the brain ETL embeds (it reads 'class')
    thermo = meta["fafb_cell_type"].astype(str).str.startswith("TRN_")
    cls[thermo] = "thermosensory"
    gust = meta["cell_class"].astype(str).str.contains("gustatory")
    cls[gust & ~is_proprio] = "gustatory"
    # Most BANC taste neurons carry no FlyWire type, so the taste pathway
    # reads BANC's own modality, in FlyWire's classification vocabulary:
    # labellar taste-bristle neurons BANC assigns sugar or water ->
    # 'sugar/water', bitter -> 'bitter' (FlyWire's labellar GRN sub-classes);
    # BANC's proboscis and pharynx motor neurons -> FlyWire's proboscis and
    # ingestion motor-neuron sub-classes.
    function = meta["cell_function_detailed"].astype(str)
    labellar = (meta["cell_class"].astype(str) == "taste_bristle_gustatory_neuron") \
        & meta["body_part_sensory"].astype(str).str.contains("labellum")
    sweet = function.str.contains(r"\b(?:sugar|water)\b")
    bitter = function.str.contains(r"\bbitter\b")
    sub[labellar & sweet & ~bitter] = "sugar/water"
    sub[labellar & bitter & ~sweet] = "bitter"
    sub[meta["cell_class"].astype(str) == "proboscis_motor_neuron"] = "proboscis_motor_neuron"
    sub[meta["cell_class"].astype(str) == "pharynx_motor_neuron"] = "ingestion_motor_neuron"
    side = meta["side"].map(SIDE)
    entry = pd.Series(None, index=meta.index, dtype=object)
    entry[is_proprio] = meta.loc[is_proprio, "body_part_sensory"].map(LEG_NERVE)
    location = meta["root_position_nm"].map(xyz)

    ann = pd.DataFrame({
        "bodyId": body.values, "type": mtype.values, "instance": (cell_type.fillna("") + "_" + side.fillna("")).values,
        "superclass": superclass.values, "class": cls.values, "subclass": sub.values,
        "somaSide": side.values, "rootSide": side.values, "somaNeuromere": meta["neuromere"].values,
        "entryNerve": entry.values, "exitNerve": meta["nerve"].values, "receptorType": None,
        "flywireType": meta["fafb_cell_type"].values, "mancType": meta["manc_cell_type"].values,
        "mancBodyid": None, "matchingNotes": None, "status": meta["status"].astype(str).values,
        "somaLocation": location.values,
    })
    ann = ann[ann["superclass"].notna()].reset_index(drop=True)
    feather.write_feather(ann, OUT / NAMES["annotations"])
    print(f"annotations: {len(ann)} cells;", ann["superclass"].value_counts().to_dict())
    print("taste:", ann[ann.subclass.isin(["sugar/water", "bitter", "proboscis_motor_neuron", "ingestion_motor_neuron"])]
          .subclass.value_counts().to_dict())
    print("leg motor neurons:", int(((ann.superclass == 'vnc_motor') & ann.subclass.isin(['fl', 'ml', 'hl'])).sum()),
          "| leg proprioceptors:", int((ann['class'] == 'mechanosensory_proprioceptive').sum()))

    nt = meta["neurotransmitter_predicted"].astype(object)
    score = pd.to_numeric(meta["neurotransmitter_score"], errors="coerce")
    nts = pd.DataFrame({"body": body.values, "cell_type": cell_type.values,
                        "total_nt_predictions": None, "predicted_nt_confidence": score.values, "predicted_nt": nt.values,
                        "ground_truth": None, "celltype_total_nt_predictions": None, "celltype_predicted_nt": None,
                        "celltype_predicted_nt_confidence": None, "consensus_nt": nt.fillna("unclear").values})
    feather.write_feather(nts, OUT / NAMES["neurotransmitters"])

    edges = feather.read_table(RAW / "banc_888_edgelist_simple_v3.feather", columns=["pre", "post", "count"])
    weights = pa.table({"body_pre": pc.cast(edges.column("pre"), pa.int64()),
                        "body_post": pc.cast(edges.column("post"), pa.int64()),
                        "weight": pc.cast(edges.column("count"), pa.int64())})
    feather.write_feather(weights, OUT / NAMES["weights"])
    print(f"weights: {weights.num_rows:,} pairs")

    # What the extraction scripts record as their source: BANC's own files,
    # not the renamed tables (they merge 'provenance' into their output).
    files = {}
    for key, name in (("annotations", "banc_888_meta.feather"), ("weights", "banc_888_edgelist_simple_v3.feather")):
        digest = hashlib.sha256()
        with open(RAW / name, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        files[key] = {"url": DOWNLOAD, "file": name, "bytes": (RAW / name).stat().st_size, "sha256": digest.hexdigest()}
    # BANC's volume is tilted against FAFB's: the brain ETL registers its
    # somata into FAFB's frame by matched cell types before drawing them.
    source = {"dataset": "BANC v888", "frame": "fafb", "provenance": {
        "dataset": "BANC v888", "specimen": "female Drosophila melanogaster", "downloadPage": DOWNLOAD,
        "license": "CC-BY-4.0", "files": files, "synapseConfidenceThreshold": None,
        "adapter": "etl_banc_adapter.py renames BANC annotations into the MaleCNS vocabulary; leg motor-neuron "
                   "channels come from BANC peripheral_target_type (muscle); taste modality from BANC "
                   "cell_function_detailed (labellar taste bristles), proboscis and ingestion motor neurons "
                   "from BANC cell_class.",
        "flywireInterface": "In the female model the brain circuit comes from the same BANC v888 animal "
                            "(etl_malecns_brain.py on etl_banc_adapter.py tables): descending and ascending cells "
                            "shared by both circuits pass their spikes cell by cell. With another brain, a modelled "
                            "activity interface between cells of the same type and side would couple them; no "
                            "synapse between different animals is claimed."}}
    (OUT / "source.json").write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
    print("source:", {k: v["sha256"][:12] for k, v in files.items()})


if __name__ == "__main__":
    main()

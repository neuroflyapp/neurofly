#!/usr/bin/env python3
"""Downloads the public graph-level tables of further fly connectomes into the
git-ignored raw_specimens/<dataset>/, for later integration. Synapse-point
and synapse-partner tables (5-20 GB each) are left out. Each dataset folder
gets a MANIFEST.json with source URL, size and SHA-256 of every file.
Previously recorded files are skipped only after SHA-256 verification.
These local digests are integrity anchors, not publisher authentication.

Usage: python fetch_specimen_data.py [dataset ...]
"""
import argparse
import hashlib
import json
import os
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
import urllib.request
from urllib.parse import quote, urlencode
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "raw_specimens"
GCS = "https://storage.googleapis.com/"
DATAVERSE = "https://dataverse.harvard.edu/api/access/datafile/"


def gcs_folder(bucket, prefix, skip=("syn-", "tbar-", "body-stats"), max_mb=1500):
    """Every file directly in a public Google Cloud Storage folder, minus
    synapse-level tables and anything larger than max_mb."""
    items, token, seen_tokens = [], None, set()
    while True:
        query = {"prefix": prefix, "delimiter": "/", "fields": "items(name,size),nextPageToken"}
        if token:
            query["pageToken"] = token
        url = f"{GCS}storage/v1/b/{quote(bucket, safe='')}/o?{urlencode(query)}"
        with urllib.request.urlopen(url, timeout=60) as response:
            page = json.load(response)
        items.extend(page.get("items", []))
        next_token = page.get("nextPageToken")
        if not next_token:
            break
        if next_token in seen_tokens:
            raise ValueError("Repeated storage listing page token")
        seen_tokens.add(next_token)
        token = next_token
    return [(GCS + f"{bucket}/{quote(i['name'], safe='/')}", i["name"].rsplit("/", 1)[-1]) for i in items
            if not i["name"].rsplit("/", 1)[-1].startswith(skip) and int(i["size"]) <= max_mb * 1e6]


DATASETS = {
    # BANC v888: one female, brain and nerve cord (Harvard Dataverse doi:10.7910/DVN/7WTH1N)
    "banc-v888": lambda: [(DATAVERSE + str(file_id), name) for file_id, name in [
        (13918810, "banc_888_edgelist_simple_v3.feather"), (14033740, "banc_888_meta.feather"),
        (13916450, "banc_888_neurotransmitter_prediction_v2.csv"), (14034271, "banc_888_metrics.feather"),
        (13916445, "backbone_proofread.parquet"), (13917708, "banc_neuropil_meshes.zip"),
        (13994485, "banc_fafb_reviewed_matches.csv.gz"), (13994488, "banc_malecns_reviewed_matches.csv.gz"),
        (13994489, "banc_manc_reviewed_matches.csv.gz"), (13994486, "banc_fanc_reviewed_matches.csv.gz"),
        (13994487, "banc_hemibrain_reviewed_matches.csv.gz"), (13916440, "acknowledgements.md")]],
    # MANC v1.0: male nerve cord (the public export bucket holds v1.0)
    "manc-v1.0": lambda: [(GCS + "flyem-manc-exports/v1.0/manc-v1.0-neuron-properties.feather",
                           "manc-v1.0-neuron-properties.feather")]
                         + gcs_folder("flyem-manc-exports", "v1.0/manc-traced-adjacencies-v1.0/"),
    # Hemibrain v1.2: part of one female brain
    "hemibrain-v1.2": lambda: [(GCS + f"hemibrain/v1.2/{name}", name) for name in [
        "exported-traced-adjacencies-v1.2.tar.gz", "hemibrain-v1.2-body-mean-neurotransmitters.feather",
        "roi-meshes.tar.gz"]],
    # Male optic lobe v1.1: right optic lobe of one male
    # (its cell types are only in the neuPrint neuron table)
    "optic-lobe-v1.1": lambda: gcs_folder("flyem-optic-lobe", "v1.1/optic-lobe-v1.1-flat-connectome/")
                               + [(GCS + "flyem-optic-lobe/v1.1/optic-lobe-v1.1-neuprint-tables/Neuprint_Neurons.feather",
                                   "Neuprint_Neurons.feather")],
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def valid_record(record, url):
    """A recorded local checksum is an integrity anchor, not publisher authentication."""
    return (isinstance(record, dict) and record.get("url") == url
            and isinstance(record.get("bytes"), int) and not isinstance(record["bytes"], bool)
            and record["bytes"] > 0 and isinstance(record.get("sha256"), str)
            and len(record["sha256"]) == 64
            and all(c in "0123456789abcdef" for c in record["sha256"]))


def safe_filename(name):
    if not isinstance(name, str) or not name or name in (".", "..") or any(c in name for c in '/\\:'):
        raise ValueError("Invalid source filename")
    return name


def atomic_json(target, value):
    partial = target.with_name(target.name + ".partial")
    with partial.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    partial.replace(target)


@contextmanager
def dataset_lock(folder):
    """Never allow two writers to replace one another's data or manifest."""
    lock = folder / ".fetch.lock"
    try:
        stream = lock.open("x", encoding="ascii")
    except FileExistsError:
        raise RuntimeError("Dataset is locked; check that no fetch is running before removing .fetch.lock") from None
    try:
        with stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        lock.unlink(missing_ok=True)


def fetch(url, target, prior=None):
    # Same size alone never proves integrity. A known digest is pinned even
    # when the source has changed: a new release requires an explicit review.
    anchored = valid_record(prior, url)
    if target.is_symlink() or target.with_name(target.name + ".partial").is_symlink():
        raise ValueError("Refusing symlink download target")
    if anchored and target.is_file() and target.stat().st_size == prior["bytes"] and sha256(target) == prior["sha256"]:
        return "present-verified"
    request = urllib.request.Request(url, headers={"User-Agent": "NeuroCause data fetch"})
    with urllib.request.urlopen(request, timeout=60) as response:
        expected = int(response.headers.get("Content-Length") or 0)
        partial = target.with_name(target.name + ".partial")
        digest, received = hashlib.sha256(), 0
        with partial.open("wb") as out:
            while block := response.read(4 * 1024 * 1024):
                out.write(block)
                digest.update(block)
                received += len(block)
            out.flush()
            os.fsync(out.fileno())
    if not received or (expected and received != expected):
        raise IOError(f"{target.name}: got {received} of {expected} bytes")
    if anchored and (received != prior["bytes"] or digest.hexdigest() != prior["sha256"]):
        raise IOError(f"{target.name}: source differs from the pinned local manifest; review the release")
    if sha256(partial) != digest.hexdigest():
        raise IOError(f"{target.name}: disk read-back checksum mismatch")
    partial.replace(target)
    return "downloaded"


def main(names, root=ROOT):
    unknown = set(names) - DATASETS.keys()
    if unknown:
        raise ValueError("Unknown dataset(s): " + ", ".join(sorted(unknown)))
    failed = False
    for name in names or DATASETS:
        folder = root / name
        if folder.is_symlink():
            raise ValueError("Refusing symlink dataset folder")
        folder.mkdir(parents=True, exist_ok=True)
        with dataset_lock(folder):
            manifest_path = folder / "MANIFEST.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"dataset": name, "files": []}
            if manifest.get("dataset") != name:
                raise ValueError("Manifest belongs to another dataset")
            records = {safe_filename(f["name"]): f for f in manifest["files"]}
            if len(records) != len(manifest["files"]):
                raise ValueError("Duplicate filenames in existing manifest")
            manifest.update(schema=2, checksumBasis="local-sha256-not-publisher-authenticated", errors=[])
            sources = DATASETS[name]()
            filenames = [safe_filename(filename) for _, filename in sources]
            if len(set(filenames)) != len(filenames):
                raise ValueError("Duplicate source filenames")
            for url, filename in sources:
                target = folder / filename
                prior = records.get(filename)
                if prior and not valid_record(prior, url):
                    raise ValueError(f"{filename}: invalid or changed provenance; review manifest")
                for attempt in range(3):
                    try:
                        status = fetch(url, target, prior)
                        records[filename] = {"name": filename, "url": url, "bytes": target.stat().st_size,
                                             "sha256": sha256(target)}
                        break
                    except (OSError, ValueError) as error:
                        status = f"failed: {type(error).__name__}"
                        if attempt < 2:
                            time.sleep(10)
                else:
                    failed = True
                    # Preserve the old integrity anchor; never bless a corrupt
                    # pre-existing file after a failed transfer.
                    manifest["errors"].append({"name": filename, "status": status})
                print(f"{name}/{filename}: {status}", flush=True)
                manifest["files"] = list(records.values())
                manifest["checkedAt"] = datetime.now(timezone.utc).isoformat()
                atomic_json(manifest_path, manifest)
    print("completed with failures" if failed else "done", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("datasets", nargs="*")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    sys.exit(main(args.datasets, args.root))

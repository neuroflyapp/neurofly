#!/usr/bin/env python3
"""Offline integrity snapshot of local research tables; never imports neurons.

Checks every manifest-listed file against the previously recorded SHA-256.
The resulting small report can be read by the app without hashing gigabytes
in the UI. Local checksum agreement is NOT publisher authentication, proof
of anatomical validity, completeness, or scientific validation.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from fetch_specimen_data import atomic_json, safe_filename, sha256, valid_record

REPO = Path(__file__).resolve().parent
PROFILES = {
    "banc-v888": {"name": "BANC v888", "sex": "female", "stage": "adult", "anatomy": "brain-and-nerve-cord"},
    "manc-v1.0": {"name": "MANC v1.0", "sex": "male", "stage": "adult", "anatomy": "nerve-cord"},
    "hemibrain-v1.2": {"name": "Hemibrain v1.2", "sex": "female", "stage": "adult", "anatomy": "partial-brain"},
    "optic-lobe-v1.1": {"name": "Male optic lobe v1.1", "sex": "male", "stage": "adult", "anatomy": "right-optic-lobe"},
    "malecns-v1": {"name": "MaleCNS v1.0", "sex": "male", "stage": "adult", "anatomy": "brain-and-nerve-cord"},
}


def check_file(folder, record):
    """Return only portable metadata, never local absolute paths or error text."""
    name = safe_filename(record.get("name"))
    result = {"name": name, "url": record.get("url"), "bytes": record.get("bytes"),
              "sha256": record.get("sha256"), "status": "invalid-record"}
    if not valid_record(record, record.get("url")) or not isinstance(record.get("url"), str) or not record["url"].startswith("https://"):
        return result
    target = folder / name
    if target.is_symlink():
        result["status"] = "unsafe-path"
        return result
    try:
        before = target.stat()
        if before.st_size != record["bytes"]:
            result["status"] = "size-mismatch"
        else:
            digest = sha256(target)
            after = target.stat()
            result["status"] = ("changed-during-check" if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
                                else "verified" if digest == record["sha256"] else "checksum-mismatch")
    except FileNotFoundError:
        result["status"] = "missing"
    except OSError:
        result["status"] = "unreadable"
    return result


def audit_dataset(dataset, folder, manifest):
    result = {"id": dataset, **PROFILES[dataset], "species": "Drosophila melanogaster",
              "runtimeImportedByAudit": False, "files": [], "errors": []}
    if folder.is_symlink() or (folder / ".fetch.lock").exists():
        result["errors"].append("unsafe-folder-or-active-download")
    elif manifest.get("dataset") != dataset or not isinstance(manifest.get("files"), list) or not manifest["files"]:
        result["errors"].append("invalid-or-empty-manifest")
    else:
        seen = set()
        for record in manifest["files"]:
            try:
                item = check_file(folder, record)
                if item["name"] in seen:
                    result["errors"].append("duplicate-manifest-filename")
                    continue
                seen.add(item["name"])
                result["files"].append(item)
            except (ValueError, TypeError, AttributeError):
                result["errors"].append("invalid-manifest-entry")
        # The list can include unresolved failures without a file record.
        if manifest.get("errors"):
            result["errors"].append("unresolved-download-failures")
    result["verifiedFiles"] = sum(f["status"] == "verified" for f in result["files"])
    result["verifiedBytes"] = sum(f["bytes"] for f in result["files"] if f["status"] == "verified")
    result["status"] = "verified" if result["files"] and not result["errors"] and result["verifiedFiles"] == len(result["files"]) else "needs-attention"
    return result


def audit(root=REPO / "raw_specimens", male_root=REPO / "raw_malecns", circuit=REPO / "data/locomotor_circuit.json"):
    report = {"schema": "neurofly-raw-audit/1", "checkedAt": datetime.now(timezone.utc).isoformat(),
              "checksumBasis": "previously-recorded-local-sha256", "publisherAuthenticated": False,
              "worldwideComplete": False, "runtimeModified": False, "datasets": []}
    for dataset in PROFILES:
        folder = male_root if dataset == "malecns-v1" else root / dataset
        try:
            if dataset == "malecns-v1":
                sources = json.loads(circuit.read_text(encoding="utf-8"))["provenance"]["files"]
                manifest = {"dataset": dataset, "files": [{"name": value["url"].rsplit("/", 1)[-1], **value} for value in sources.values()]}
            else:
                manifest = json.loads((folder / "MANIFEST.json").read_text(encoding="utf-8"))
            item = audit_dataset(dataset, folder, manifest)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            item = audit_dataset(dataset, folder, {})
        report["datasets"].append(item)
    report["verifiedFiles"] = sum(d["verifiedFiles"] for d in report["datasets"])
    report["verifiedBytes"] = sum(d["verifiedBytes"] for d in report["datasets"])
    report["status"] = "verified" if all(d["status"] == "verified" for d in report["datasets"]) else "needs-attention"
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=REPO / "raw_specimens")
    parser.add_argument("--male-root", type=Path, default=REPO / "raw_malecns")
    parser.add_argument("--output", type=Path, default=REPO / "windows/assets/connectomes/raw-source-audit.json")
    args = parser.parse_args()
    report = audit(args.root, args.male_root)
    atomic_json(args.output, report)
    for dataset in report["datasets"]:
        print(f"{dataset['id']}: {dataset['status']} ({dataset['verifiedFiles']}/{len(dataset['files'])} files)")
    raise SystemExit(0 if report["status"] == "verified" else 1)

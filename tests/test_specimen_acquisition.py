"""Standard-library-only, offline regression tests for research-file integrity."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_specimen_data as fetcher
import audit_raw_specimens as auditor


class Response(io.BytesIO):
    def __init__(self, data, length=None):
        super().__init__(data)
        self.headers = {} if length is None else {"Content-Length": str(length)}


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="neurofly-data-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "source.feather"
        self.payload = b"reference bytes"
        self.url = "https://example.org/source.feather"
        self.record = {"name": self.target.name, "url": self.url, "bytes": len(self.payload),
                       "sha256": hashlib.sha256(self.payload).hexdigest()}

    def test_verified_existing_file_needs_no_network(self):
        self.target.write_bytes(self.payload)
        with patch.object(fetcher.urllib.request, "urlopen") as network:
            self.assertEqual(fetcher.fetch(self.url, self.target, self.record), "present-verified")
            network.assert_not_called()

    def test_same_size_corruption_is_repaired(self):
        self.target.write_bytes(b"x" * len(self.payload))
        with patch.object(fetcher.urllib.request, "urlopen", return_value=Response(self.payload, len(self.payload))):
            self.assertEqual(fetcher.fetch(self.url, self.target, self.record), "downloaded")
        self.assertEqual(self.target.read_bytes(), self.payload)

    def test_unanchored_same_size_file_is_not_trusted(self):
        self.target.write_bytes(b"x" * len(self.payload))
        with patch.object(fetcher.urllib.request, "urlopen", return_value=Response(self.payload, len(self.payload))) as network:
            fetcher.fetch(self.url, self.target)
            network.assert_called_once()
        self.assertEqual(self.target.read_bytes(), self.payload)

    def test_changed_remote_content_cannot_replace_integrity_anchor(self):
        original = b"x" * len(self.payload)
        self.target.write_bytes(original)
        with patch.object(fetcher.urllib.request, "urlopen", return_value=Response(original, len(original))):
            with self.assertRaisesRegex(OSError, "pinned"):
                fetcher.fetch(self.url, self.target, self.record)
        self.assertEqual(self.target.read_bytes(), original)

    def test_truncated_transfer_preserves_existing_file(self):
        self.target.write_bytes(b"old")
        with patch.object(fetcher.urllib.request, "urlopen", return_value=Response(b"short", 100)):
            with self.assertRaises(OSError):
                fetcher.fetch(self.url, self.target)
        self.assertEqual(self.target.read_bytes(), b"old")

    def test_readback_failure_does_not_promote_partial(self):
        with patch.object(fetcher.urllib.request, "urlopen", return_value=Response(self.payload)), patch.object(fetcher, "sha256", return_value="0" * 64):
            with self.assertRaisesRegex(OSError, "read-back"):
                fetcher.fetch(self.url, self.target)
        self.assertFalse(self.target.exists())

    def test_audit_detects_corruption_missing_and_wrong_specimen(self):
        self.target.write_bytes(self.payload)
        manifest = {"dataset": "banc-v888", "files": [self.record]}
        self.assertEqual(auditor.audit_dataset("banc-v888", self.root, manifest)["status"], "verified")
        self.target.write_bytes(b"x" * len(self.payload))
        self.assertEqual(auditor.check_file(self.root, self.record)["status"], "checksum-mismatch")
        self.target.unlink()
        self.assertEqual(auditor.check_file(self.root, self.record)["status"], "missing")
        self.assertEqual(auditor.audit_dataset("manc-v1.0", self.root, manifest)["status"], "needs-attention")

    def test_audit_duplicate_and_failed_manifest_not_complete(self):
        self.target.write_bytes(self.payload)
        for manifest in [{"dataset": "banc-v888", "files": [self.record, self.record]},
                         {"dataset": "banc-v888", "files": [self.record], "errors": [{"name": "missing"}]}]:
            self.assertEqual(auditor.audit_dataset("banc-v888", self.root, manifest)["status"], "needs-attention")

    def test_manifest_traversal_rejected(self):
        for name in ["../secret", "C:\\secret", "file:stream", ".", "..", ""]:
            with self.assertRaises(ValueError):
                fetcher.safe_filename(name)

    def test_lock_prevents_overlapping_writers(self):
        with fetcher.dataset_lock(self.root):
            with self.assertRaises(RuntimeError):
                with fetcher.dataset_lock(self.root):
                    self.fail("a second writer entered")
            self.assertEqual(auditor.audit_dataset("banc-v888", self.root, {})["status"], "needs-attention")
        self.assertFalse((self.root / ".fetch.lock").exists())

    def test_failure_preserves_manifest_hash_instead_of_blessing_corruption(self):
        folder = self.root / "banc-v888"
        folder.mkdir()
        (folder / self.target.name).write_bytes(b"x" * len(self.payload))
        fetcher.atomic_json(folder / "MANIFEST.json", {"dataset": "banc-v888", "files": [self.record]})
        with patch.dict(fetcher.DATASETS, {"banc-v888": lambda: [(self.url, self.target.name)]}), patch.object(fetcher, "fetch", side_effect=OSError("offline")), patch.object(fetcher.time, "sleep"):
            self.assertEqual(fetcher.main(["banc-v888"], self.root), 1)
        manifest = json.loads((folder / "MANIFEST.json").read_text())
        self.assertEqual(manifest["files"][0]["sha256"], self.record["sha256"])
        self.assertEqual(len(manifest["errors"]), 1)

    def test_listing_pagination_and_url_encoding(self):
        pages = [Response(json.dumps({"items": [{"name": "prefix/a b", "size": "10"}], "nextPageToken": "A+/="}).encode()),
                 Response(json.dumps({"items": [{"name": "prefix/c", "size": "20"}]}).encode())]
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=pages) as network:
            files = fetcher.gcs_folder("bucket", "prefix/")
        self.assertEqual(len(files), 2)
        self.assertIn("a%20b", files[0][0])
        self.assertIn("pageToken=A%2B%2F%3D", network.call_args_list[1].args[0])


if __name__ == "__main__":
    unittest.main()

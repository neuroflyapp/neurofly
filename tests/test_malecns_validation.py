"""ETL input contracts; requires the same numpy/pandas/pyarrow as extraction."""
from pathlib import Path
import tempfile
import unittest
import pandas as pd
import pyarrow as pa
import pyarrow.ipc as ipc
from etl_malecns import indexed_table, scan_weights, ranked, require


class MaleCNSValidationTests(unittest.TestCase):
    def test_checks_survive_optimized_python(self):
        with self.assertRaises(ValueError):
            require(False, "invalid scientific input")

    def test_identity_requires_unique_exact_positive_ids(self):
        for ids in [[1, 1], [0, 1], [-1, 1], [1.0, 2.0], [1, None], ['1', '2']]:
            with self.assertRaises(ValueError):
                indexed_table(pd.DataFrame({'body': ids, 'consensus_nt': ['gaba', 'gaba']}), 'body', ['consensus_nt'], 'NT')
        source = pd.DataFrame({'body': [9007199254740993, 9007199254740995], 'consensus_nt': ['gaba', None]})
        self.assertEqual(list(indexed_table(source, 'body', ['consensus_nt'], 'NT').index), list(source.body))
        with self.assertRaises(ValueError):
            indexed_table(source, 'body', ['missing'], 'NT')

    def test_ties_are_order_independent(self):
        for ids in [[9, 2, 7], [7, 9, 2]]:
            self.assertEqual(ranked(pd.Series([5, 5, 5], index=ids), 2), [2, 7])

    def scan(self, pre, post, weight):
        with tempfile.TemporaryDirectory(prefix='neurofly-etl-test-') as directory:
            file = Path(directory) / 'weights.feather'
            table = pa.table({'body_pre': pre, 'body_post': post, 'weight': weight})
            with pa.OSFile(str(file), 'wb') as stream:
                with ipc.new_file(stream, table.schema) as writer:
                    writer.write_table(table)
            return scan_weights(file, pd.DataFrame(index=pd.Index([1, 2], dtype='int64')))

    def test_invalid_edges_fail_closed(self):
        for pre, post, weights in [([1], [2], [-5]), ([1], [2], [0]), ([1], [2], [5.5]),
                                   ([0], [2], [5]), ([1], [2], [None]), ([1, 1], [2, 2], [5, 6]),
                                   ([3], [4], [10])]:
            with self.assertRaises(ValueError):
                self.scan(pre, post, weights)

    def test_full_inputs_include_subthreshold_and_out_of_pool_contacts(self):
        edges, rows, contacts, incoming, outgoing = self.scan([1, 3, 1], [2, 2, 2], [7, 9, 2])
        self.assertEqual((rows, contacts), (3, 18))
        self.assertEqual(list(edges.weight), [7])
        self.assertEqual(list(incoming), [0, 18])
        self.assertEqual(list(outgoing), [9, 0])


if __name__ == '__main__':
    unittest.main()

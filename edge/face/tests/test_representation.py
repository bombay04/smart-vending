from __future__ import annotations

import unittest

import numpy

from edge.face.config import (
    LBP_BIN_COUNT,
    LBP_GRID_COLUMNS,
    LBP_GRID_ROWS,
    REPRESENTATION_LENGTH,
)
from edge.face.representation import (
    _build_uniform_lbp_lookup,
    _calculate_lbp_codes,
    create_representation,
)


class RepresentationTests(unittest.TestCase):
    def test_uniform_lbp_lookup_has_58_patterns_and_one_catch_all_bin(self) -> None:
        lookup = _build_uniform_lbp_lookup()
        self.assertEqual(len(set(int(value) for value in lookup)), LBP_BIN_COUNT)
        self.assertEqual(int(numpy.count_nonzero(lookup != LBP_BIN_COUNT - 1)), 58)
        self.assertNotEqual(int(lookup[0]), LBP_BIN_COUNT - 1)
        self.assertNotEqual(int(lookup[255]), LBP_BIN_COUNT - 1)
        self.assertEqual(int(lookup[0b01010101]), LBP_BIN_COUNT - 1)

    def test_uint8_neighbor_comparisons_do_not_overflow(self) -> None:
        image = numpy.array(
            [[0, 255, 0], [255, 128, 0], [129, 127, 128]],
            dtype=numpy.uint8,
        )
        codes = _calculate_lbp_codes(image)
        self.assertEqual(int(codes[0, 0]), 210)

    def test_representation_has_normalized_spatial_histograms(self) -> None:
        image = numpy.arange(96 * 96, dtype=numpy.uint8).reshape((96, 96))
        representation = create_representation(image)
        self.assertEqual(len(representation), REPRESENTATION_LENGTH)

        for cell_index in range(LBP_GRID_ROWS * LBP_GRID_COLUMNS):
            start = cell_index * LBP_BIN_COUNT
            cell_histogram = representation[start : start + LBP_BIN_COUNT]
            self.assertAlmostEqual(sum(cell_histogram), 1.0, places=6)

    def test_representation_is_deterministic_for_identical_input(self) -> None:
        image = numpy.arange(96 * 96, dtype=numpy.uint8).reshape((96, 96))
        self.assertEqual(create_representation(image), create_representation(image))


if __name__ == "__main__":
    unittest.main()

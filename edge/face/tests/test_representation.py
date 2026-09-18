from __future__ import annotations

import unittest

import numpy

from edge.face.config import (
    LBP_BIN_COUNT,
    LBP_GRID_COLUMNS,
    LBP_GRID_ROWS,
    REPRESENTATION_LENGTH,
)
from edge.face.representation import create_representation


class RepresentationTests(unittest.TestCase):
    def test_representation_has_normalized_spatial_histograms(self) -> None:
        image = numpy.arange(96 * 96, dtype=numpy.uint8).reshape((96, 96))
        representation = create_representation(image)
        self.assertEqual(len(representation), REPRESENTATION_LENGTH)

        for cell_index in range(LBP_GRID_ROWS * LBP_GRID_COLUMNS):
            start = cell_index * LBP_BIN_COUNT
            cell_histogram = representation[start : start + LBP_BIN_COUNT]
            self.assertAlmostEqual(sum(cell_histogram), 1.0, places=6)


if __name__ == "__main__":
    unittest.main()


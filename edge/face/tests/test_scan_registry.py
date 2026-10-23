from __future__ import annotations

import unittest

from edge.face.scan_registry import FaceScanRegistry


class FaceScanRegistryTests(unittest.TestCase):
    def test_duplicate_scan_id_cannot_bypass_an_active_or_completed_scan(self):
        registry = FaceScanRegistry()
        self.assertTrue(registry.begin("scan-1234567890123456"))
        self.assertFalse(registry.begin("scan-1234567890123456"))
        registry.finish("scan-1234567890123456", "SUCCESS")
        self.assertFalse(registry.begin("scan-1234567890123456"))

    def test_preview_is_ephemeral_and_cancel_is_observable(self):
        registry = FaceScanRegistry()
        scan_id = "scan-1234567890123456"
        registry.begin(scan_id)
        registry.update(scan_id, "TURN_LEFT", "TURN_LEFT", 1, 2)
        registry.set_jpeg(scan_id, b"jpeg")
        self.assertEqual(registry.jpeg(scan_id), b"jpeg")
        self.assertEqual(registry.status(scan_id)["previewVersion"], 1)
        registry.set_jpeg(scan_id, b"newer-jpeg")
        self.assertEqual(registry.jpeg(scan_id), b"newer-jpeg")
        self.assertEqual(registry.status(scan_id)["previewVersion"], 2)
        self.assertTrue(registry.cancel(scan_id))
        self.assertTrue(registry.is_cancelled(scan_id))
        self.assertEqual(registry.status(scan_id)["state"], "CANCELLED")
        self.assertIsNone(registry.jpeg(scan_id))


if __name__ == "__main__":
    unittest.main()

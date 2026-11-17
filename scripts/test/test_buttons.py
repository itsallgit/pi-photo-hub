"""Tests for photo-buttons.py's mapping logic with recorded event sequences (no evdev, no Pi)."""
import importlib.util
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("photo_buttons", os.path.join(HERE, "..", "photo-buttons.py"))
pb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pb)
REPO_CONFIG = os.path.join(HERE, "..", "..", "config", "buttons.json")


class MapperTest(unittest.TestCase):
    def setUp(self):
        self.cfg = pb.load_config(REPO_CONFIG)
        self.m = pb.Mapper(self.cfg)

    def paths(self, actions):
        return [a["path"] for a in actions]

    def test_repo_config_is_valid_and_maps_six_inputs(self):
        self.assertTrue({"KEY_F13", "KEY_F14", "KEY_F15", "KEY_F16", "KEY_F17", "KEY_F18"} <= self.m.keys())

    def test_key_without_long_fires_on_press(self):
        self.assertEqual(self.paths(self.m.event("KEY_F13", 1, 10.0)), ["/api/player/back"])
        self.assertEqual(self.m.event("KEY_F13", 0, 10.1), [])

    def test_short_press_of_a_key_with_long(self):
        self.assertEqual(self.m.event("KEY_F14", 1, 10.0), [])
        self.assertEqual(self.m.tick(10.3), [])
        self.assertEqual(self.paths(self.m.event("KEY_F14", 0, 10.3)), ["/api/player/toggle"])

    def test_long_press_fires_while_held_once(self):
        self.m.event("KEY_F14", 1, 10.0)
        self.assertEqual(self.m.tick(10.5), [])
        self.assertEqual(self.paths(self.m.tick(10.71)), ["/api/screen/toggle"])
        self.assertEqual(self.m.tick(11.5), [])
        self.assertEqual(self.m.event("KEY_F14", 2, 11.6), [])  # auto-repeat ignored
        self.assertEqual(self.m.event("KEY_F14", 0, 12.0), [])  # nothing more on release

    def test_long_press_by_release_time_when_ticks_were_late(self):
        self.m.event("KEY_F14", 1, 10.0)
        self.assertEqual(self.paths(self.m.event("KEY_F14", 0, 11.0)), ["/api/screen/toggle"])

    def test_knob_and_unknown_keys(self):
        a = self.m.event("KEY_F16", 1, 1)[0]
        self.assertEqual((a["path"], a["body"]), ("/api/player/nudge", {"setting": "interval", "by": 1}))
        self.assertEqual(self.m.event("KEY_A", 1, 1), [])

    def test_bad_config_is_refused(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"map": {"F13": {"press": {"path": "/x"}}}}, fh)
        try:
            with self.assertRaises(ValueError):
                pb.load_config(fh.name)
        finally:
            os.unlink(fh.name)


if __name__ == "__main__":
    unittest.main()

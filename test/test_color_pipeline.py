import unittest

from src.color_pipeline import (
    correct_frame,
    correct_movie,
    gamma_table,
    saturate_frame,
)


class ColorPipelineTests(unittest.TestCase):
    def test_gamma_darkens_midtones_and_keeps_the_endpoints(self) -> None:
        table = gamma_table(2.2)

        self.assertEqual(table[0], 0)
        self.assertEqual(table[255], 255)
        # sRGB mid grey is ~21% of full light, not 50%.
        self.assertLess(table[128], 70)
        self.assertGreater(table[128], 45)

    def test_gamma_table_is_monotonic(self) -> None:
        table = gamma_table(2.2)
        self.assertEqual(list(table), sorted(table))

    def test_black_floor_lifts_every_visible_level_but_not_black(self) -> None:
        table = gamma_table(2.2, black_floor=10)

        self.assertEqual(table[0], 0, "true black must stay black")
        self.assertGreaterEqual(table[1], 10, "faintest level clears the floor")
        self.assertEqual(table[255], 255)

    def test_gamma_rejects_a_non_positive_exponent(self) -> None:
        with self.assertRaisesRegex(ValueError, "Gamma must be positive"):
            gamma_table(0)

    def test_saturation_of_one_returns_the_frame_untouched(self) -> None:
        frame = bytes([10, 90, 200, 3, 3, 3])
        self.assertIs(saturate_frame(frame, 1.0), frame)

    def test_saturation_pushes_channels_away_from_luma(self) -> None:
        frame = bytes([200, 100, 50])
        boosted = saturate_frame(frame, 1.5)

        self.assertGreater(boosted[0], 200)
        self.assertLess(boosted[2], 50)

    def test_grey_stays_grey_at_any_saturation(self) -> None:
        grey = bytes([120, 120, 120])
        self.assertEqual(saturate_frame(grey, 2.0), grey)

    def test_saturation_clamps_into_byte_range(self) -> None:
        boosted = saturate_frame(bytes([255, 0, 0]), 4.0)
        self.assertEqual(boosted[0], 255)
        self.assertEqual(boosted[1], 0)

    def test_saturation_rejects_negative_amounts(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot be negative"):
            saturate_frame(bytes([1, 2, 3]), -0.5)

    def test_correct_frame_applies_saturation_before_gamma(self) -> None:
        frame = bytes([200, 100, 50])
        expected = saturate_frame(frame, 1.25).translate(gamma_table(2.2))

        self.assertEqual(
            correct_frame(frame, gamma=2.2, saturation=1.25), expected
        )

    def test_correcting_a_movie_matches_correcting_each_frame(self) -> None:
        first = bytes([10, 20, 30, 200, 100, 50])
        second = bytes([0, 0, 0, 255, 255, 255])

        self.assertEqual(
            correct_movie(first + second),
            correct_frame(first) + correct_frame(second),
        )

    def test_black_frames_survive_correction_unchanged(self) -> None:
        self.assertEqual(correct_movie(bytes(30)), bytes(30))


if __name__ == "__main__":
    unittest.main()

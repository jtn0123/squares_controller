import base64
import unittest

from src.movie_payload import decode_movie_payload


class MoviePayloadTests(unittest.TestCase):
    def test_decodes_exact_bounded_rgb_movie(self) -> None:
        pixels = bytes(range(12))

        movie = decode_movie_payload(
            {
                "name": "LOCAL LOOP",
                "width": 2,
                "height": 1,
                "frameCount": 2,
                "fps": 37.5,
                "pixelsBase64": base64.b64encode(pixels).decode("ascii"),
            }
        )

        self.assertEqual(movie["pixels"], pixels)
        self.assertEqual(movie["frame_count"], 2)
        self.assertEqual(movie["fps"], 37.5)

    def test_rejects_oversized_and_malformed_movies(self) -> None:
        with self.assertRaisesRegex(ValueError, "1 to 600"):
            decode_movie_payload(
                {
                    "width": 1,
                    "height": 1,
                    "frameCount": 601,
                    "fps": 38,
                    "pixelsBase64": "",
                }
            )
        with self.assertRaisesRegex(ValueError, "Expected 6"):
            decode_movie_payload(
                {
                    "width": 1,
                    "height": 1,
                    "frameCount": 2,
                    "fps": 38,
                    "pixelsBase64": base64.b64encode(b"\0\0\0").decode("ascii"),
                }
            )

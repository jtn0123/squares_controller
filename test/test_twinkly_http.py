import base64
import json
import unittest
import urllib.error
from unittest.mock import patch

from src.twinkly_client import TwinklyClient
from src.twinkly_protocol import TwinklyHTTPError


class FakeResponse:
    def __init__(self, payload):
        self._data = (
            payload
            if isinstance(payload, bytes)
            else json.dumps(payload).encode("utf-8")
        )

    def read(self, *args):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "http://192.168.1.50/xled/v1/test", code, "boom", None, None
    )


VALID_TOKEN = base64.b64encode(b"12345678").decode("ascii")


class TwinklyHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TwinklyClient("192.168.1.50")

    def tearDown(self) -> None:
        self.client.close(restore_movie=False)

    def test_fetch_json_sends_token_header_and_parses_body(self) -> None:
        with patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeResponse({"code": 1000, "mode": "movie"})
            result = self.client._fetch_json("/led/mode", token="tok-123")

        self.assertEqual(result["mode"], "movie")
        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url, "http://192.168.1.50/xled/v1/led/mode"
        )
        self.assertEqual(request.get_header("X-auth-token"), "tok-123")

    def test_http_failure_carries_its_status_code(self) -> None:
        with patch("urllib.request.urlopen", side_effect=http_error(500)):
            with self.assertRaises(TwinklyHTTPError) as caught:
                self.client._fetch_json("/led/mode")

        self.assertEqual(caught.exception.status_code, 500)
        self.assertEqual(
            str(caught.exception), "Twinkly /led/mode failed with HTTP 500."
        )

    def test_unreachable_device_raises_connection_error(self) -> None:
        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError("timed out"),
        ):
            with self.assertRaisesRegex(ConnectionError, "Cannot reach Twinkly"):
                self.client._fetch_json("/gestalt")

    def test_device_error_codes_raise_connection_error(self) -> None:
        with patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeResponse({"code": 1101})
            with self.assertRaisesRegex(ConnectionError, "code 1101"):
                self.client._fetch_json("/led/mode")

    def test_malformed_json_body_raises_value_error(self) -> None:
        with patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value = FakeResponse(b"not json at all")
            with self.assertRaises(ValueError):
                self.client._fetch_json("/led/mode")

    def test_authenticate_runs_challenge_login_verify_handshake(self) -> None:
        responses = [
            FakeResponse(
                {
                    "authentication_token": VALID_TOKEN,
                    "challenge-response": "prove-it",
                }
            ),
            FakeResponse({"code": 1000}),
        ]
        with patch("urllib.request.urlopen", side_effect=responses) as urlopen:
            token = self.client.authenticate()

        self.assertEqual(token, VALID_TOKEN)
        login_request = urlopen.call_args_list[0].args[0]
        verify_request = urlopen.call_args_list[1].args[0]
        self.assertTrue(login_request.full_url.endswith("/login"))
        self.assertTrue(verify_request.full_url.endswith("/verify"))
        self.assertEqual(
            json.loads(verify_request.data)["challenge-response"], "prove-it"
        )
        self.assertEqual(
            verify_request.get_header("X-auth-token"), VALID_TOKEN
        )

    def test_expired_token_triggers_one_reauthentication_retry(self) -> None:
        import time

        self.client.token = "stale-token"
        self.client.token_created_at = time.monotonic()
        responses = [
            http_error(401),
            FakeResponse(
                {
                    "authentication_token": VALID_TOKEN,
                    "challenge-response": "prove-it",
                }
            ),
            FakeResponse({"code": 1000}),
            FakeResponse({"code": 1000, "mode": "movie"}),
        ]
        with patch("urllib.request.urlopen", side_effect=responses) as urlopen:
            result = self.client.request("/led/mode")

        self.assertEqual(result["mode"], "movie")
        self.assertEqual(urlopen.call_count, 4)
        self.assertEqual(self.client.token, VALID_TOKEN)


if __name__ == "__main__":
    unittest.main()

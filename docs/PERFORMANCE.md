# Frame Pipeline

Squares Controller has four independent timing stages:

1. Procedural effects, uploaded media, microphone visuals, and screen capture
   prepare new frames on a phase-aligned browser clock.
2. The browser keeps only the latest pending frame, permits one HTTP upload at
   a time, and discards obsolete queued work.
3. The Python relay repeats the most recent complete frame on an independent
   37.5 FPS deadline clock. Missed deadlines are skipped instead of sent as
   catch-up bursts.
4. The connected Twinkly Squares master advertises 40 FPS and reports a
   measured 38.46 FPS clock.
5. Finite looks can instead be stored and played by the controller at 38 FPS,
   removing the first three realtime timing stages during playback.

## Actual-device measurements

The initial and first-pass results used Signal Sweep; the 40 FPS
deadline-alignment result used Plasma Field. All were measured through the
browser and over the Mac's Wi-Fi socket to the same 768-LED, 12-panel Squares
installation:

| Measurement | Initial | First pass | Current |
| --- | ---: | ---: | ---: |
| New browser frames | 18.17 FPS | 37.3 FPS | 39.998 FPS |
| Panel-bound relay frames | 25 FPS | 40 FPS | 40 FPS |
| UDP payload and protocol bytes | 58,500 B/s | 93,600 B/s | 93,600 B/s |

The current browser result came from 619 timestamped frame requests over
15.451 seconds. Median upload spacing was 25.063 ms, p95 was 27.165 ms, and the
maximum was 29.353 ms. Deadline alignment prevents ordinary timer lateness from
accumulating across later uploads.

The relay held approximately 93,600 B/s, reported no controller error, and the
local Python process used approximately 6.4% CPU and 21 MB of memory while
Plasma Field was rendering during the final check. The relay repeats the newest
frame when browser timing does not supply a new one for a particular 25 ms
deadline.

A later live-device trial aligned the relay below the controller's measured
38.46 FPS clock. Over 804 sends it averaged 37.50 FPS with no full missed
deadlines. Browser generation supplied 706 unique frames and the relay repeated
98 latest frames. Host scheduling still produced a 29.403 ms p95 send gap and
31.481 ms maximum gap. These measurements prove transport cadence, not optical
display cadence; the app labels them accordingly.

## Higher-rate controller stress trial

The connected Squares master returned `frame_rate: 40` from its live
`/xled/v1/gestalt` response. A separate direct-UDP stress trial then transmitted
unique frames for eight seconds at each candidate rate:

| Target | Transmitted | UDP errors | Device mode | REST response |
| ---: | ---: | ---: | --- | ---: |
| 40 FPS | 40.00 FPS | 0 | `rt` | 41.8 ms |
| 50 FPS | 50.00 FPS | 0 | `rt` | 30.9 ms |
| 60 FPS | 60.00 FPS | 0 | `rt` | 47.4 ms |
| 75 FPS | 75.00 FPS | 0 | `rt` | 192.5 ms |
| 100 FPS | 100.00 FPS | 0 | `rt` | 158.5 ms |

This proves that the Mac, Wi-Fi path, and UDP receiver can tolerate additional
traffic for a short trial. It does not prove that the LED engine displays more
than the 40 unique frames per second declared by the controller because the
realtime UDP protocol provides no displayed-frame acknowledgement. The sharp
REST-latency increase at 75 and 100 FPS also makes those rates a worse production
default. Slow-motion optical testing then showed obvious missing counter frames
at 60 FPS and roughly one or two missing frames per 15 at 40 FPS. Squares
Controller therefore no longer treats successful UDP transmission as displayed
frame proof.

## Software-only measurements

Measurements were collected without connecting to or sending frames to a
display. The JavaScript result includes converting a typed RGB frame to the
current JSON request body. The Python result includes raster mapping, realtime
brightness scaling, and UDP packet construction.

| Pixels | Panels | JSON bytes/frame | JS preparation | Python preparation | UDP packets |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 768 | 12 | 8,261 | 0.0479 ms | 0.1726 ms | 3 |
| 960 | 15 | 10,271 | 0.0458 ms | 0.2232 ms | 4 |
| 1,024 | 16 | 11,003 | 0.0484 ms | 0.2315 ms | 4 |

At the maximum supported 1,024 pixels, measured preparation remains well below
one millisecond per frame. Moving from 12 to 16 panels increases raw RGB data
from 2,304 to 3,072 bytes per frame, which is not enough to force a lower
cadence on a modern Mac or ordinary local Wi-Fi.

## Motion study: delivered cadence by target rate

Run with `python3 scripts/motion_study.py [brightness] [rates...]`. Ten
seconds of continuous diagonal-sweep motion per rate, measured on the live
32×24 wall at 10% brightness after the one-clock relay change:

| Target | Delivered | p95 fresh gap | Max fresh gap | Repeats | Late | Missed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 FPS | 24.14 FPS | 45.8 ms | 46.9 ms | 0 | 0 | 0 |
| 30 FPS | 30.07 FPS | 36.4 ms | 38.4 ms | 0 | 0 | 0 |
| 33 FPS | 33.07 FPS | 33.6 ms | 36.1 ms | 0 | 0 | 0 |
| 36 FPS | 35.97 FPS | 29.0 ms | 31.0 ms | 0 | 0 | 0 |

Every rate delivered every fresh frame: no repeats, no late sends, no
missed deadlines. Measured gaps track the producer's own send spacing
(within ~1 ms), which means the relay adds no cadence of its own — it
forwards what it is given, when it is given. Host transport is therefore
not a source of visible judder at any of these rates, and a lower target
rate does not buy smoothness.

As always these are transport measurements, not optical ones.

## Live-wall capability probe

`scripts/capability_probe.py` puts one question per colour on the wall.
Observed on the 32×24 wall at 10% hardware brightness, 36 FPS:

| Zone | Test | Result |
| --- | --- | --- |
| Red | 24-step gamma ramp | Darkest 4 steps invisible |
| Green | raw PWM 0…23, one per row | Rows 0–9 invisible |
| Blue | one row per sent frame | Marches, but visibly cuts out |
| Amber | full on/off every frame | Visibly flickers — see the caveat below |

Two independent conclusions.

**There is a black floor.** At 10% brightness the panel emits no light
below roughly PWM 10, so the bottom ~4% of the range is dead. Gamma
correction pushes shadow detail straight into that dead zone, which is
why the darkest four bands of the gamma ramp vanished. Gamma therefore
needs a black-floor lift — map non-zero output into `[floor, 255]` and
keep true zero as true black — and the floor rises as brightness falls,
so it has to be calibrated at the operating brightness.

**Frames are being lost, and host telemetry cannot see it.** The
one-row-per-frame marker visibly cuts out: rows the host sent never
appear. The realtime protocol has no acknowledgement, so "missed
deadlines: 0" only ever proved the host *sent* on time.

The amber zone does *not* support that conclusion, and an earlier
version of this document wrongly claimed it did. Alternating on/off
every frame at 36 FPS is an 18 Hz square wave — well below flicker
fusion — so it flickers visibly even when every frame is displayed
perfectly. Only the marching marker, and the baked-versus-streamed
comparison below, are evidence of loss. Proving it precisely would need
optical capture of frame-identifiable content.

### Correction: latency is not loss

An earlier airtime trial measured round-trip latency while streaming at
12/20/28/36 FPS and found no relationship (55–70 ms average at every
rate), which was read as "send rate does not matter". That measured the
wrong quantity. ICMP at 5 packets/second does not stress the panel's
receive path, whereas realtime streaming costs three UDP packets per
frame — 108 packets/second at 36 FPS. Displayed-frame integrity has to
be judged from the panel's output, not from ping.

## Delivery path is the limit, not the frame rate

Every rate experiment varied settings *inside* the streaming path, which
could never answer whether the path itself was the problem. Running the
identical animation three ways on the live wall settled it
(`scripts/path_study.py`, `scripts/bake_vs_stream.py`):

| Path | Result |
| --- | --- |
| Baked to panel storage | Flawless |
| Realtime UDP, fragments back to back | Judders |
| Realtime UDP, fragments spread over the frame interval | Judders |

Spacing the three per-frame fragments did not help, so the loss is not a
receive burst that pacing can smooth out. The panel is a 2.4 GHz radio
carrying 55–180 ms of latency jitter against a 28 ms frame budget, while
this Mac's own link to the same access point is a steady 7 ms ± 0.7 ms.
Baked playback runs from panel storage on the panel's clock with no
network in the loop, which is why the stock movies look perfect.

Smooth motion therefore comes from baking, not from tuning the stream.
Realtime remains the right path for painting, live audio, and screen
mirroring, where responsiveness matters more than even cadence — and it
is worth saying plainly in the UI that those paths differ.

### Baking was broken on real firmware

Worth recording because it hid the good path for a long time: the
controller echoes a movie's `unique_id` upper-cased while `uuid4()`
emits lower case, and the post-upload identity lookup compared them
case-sensitively. Every successful bake therefore raised "Movie uploaded
but the controller did not return its identity", and the app never
selected or played the result.

### Known gap

Selecting an already-stored movie is supported now (`POST
/api/movies/select`), so the app can recall any bake rather than only
the one it just made. Removing a movie is still missing, and cannot be
added the same way: the XLED v1 API exposes only a delete-everything
call, which would take the user's own Twinkly-app movies with it.

## Further optimization threshold

Realtime output now exposes permanent relay telemetry, while finite output can
be baked to unused controller storage. Controller-local playback is the
preferred high-fidelity path because it removes browser timing, JSON upload,
Python wakeup jitter, and Wi-Fi timing from each displayed frame. Realtime mode
remains necessary for painting, live audio, and screen mirroring; its fastest
optically lossless target still requires camera validation rather than another
transport-only benchmark.

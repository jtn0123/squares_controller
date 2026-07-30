# Frame Pipeline

Squares Controller has four independent timing stages:

1. Procedural effects, uploaded media, microphone visuals, and screen capture
   use a phase-aligned 25 ms clock.
2. The browser keeps only the latest pending frame, permits one HTTP upload at
   a time, and starts uploads at most once every 25 ms.
3. The Python relay repeats the most recent complete frame on a 25 ms deadline
   clock. Missed deadlines are skipped instead of sent as catch-up bursts.
4. The connected Twinkly Squares master reports a 40 FPS device capability.

## Actual-device measurements

The initial and first-pass results used Signal Sweep; the current
deadline-alignment result used Plasma Field. Both were measured through the
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
default. Squares Controller therefore keeps the device-advertised 40 FPS target.

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

## Further optimization threshold

The present transport reaches the device's reported native cadence without a
new dependency or protocol. A binary endpoint, persistent socket, or permanent
telemetry layer should only be added if longer trials or larger layouts show a
measured regression. Server-side procedural rendering remains the larger option
if animations must continue at full speed while the browser is suspended.

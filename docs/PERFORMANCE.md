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

Signal Sweep was measured through the browser and over the Mac's Wi-Fi socket
to a 768-LED, 12-panel Squares installation:

| Measurement | Before | Optimized |
| --- | ---: | ---: |
| New browser frames | 18.17 FPS | 37.3 FPS |
| Panel-bound relay frames | 25 FPS | 40 FPS |
| UDP payload and protocol bytes | 58,500 B/s | 93,600 B/s |

The optimized relay held 93,600 B/s in each steady one-second sample, reported
no controller error, and used approximately 4.3% CPU and 22 MB of memory on the
local Python process. The relay repeats the newest frame when browser timing
does not supply a new one for a particular 25 ms deadline.

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

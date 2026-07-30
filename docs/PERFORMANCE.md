# Frame Pipeline

Squares Controller has four independent timing stages:

1. Procedural effects, uploaded media, microphone visuals, and screen capture
   sample at most once every 50 ms (20 FPS).
2. The browser coalesces HTTP frame uploads to at most once every 45 ms
   (approximately 22 FPS).
3. The Python relay repeats the most recent complete frame every 40 ms (25 FPS).
4. The tested Twinkly Squares master reports a 40 FPS device capability.

The current visible frame rate is therefore limited by deliberate browser and
relay timers. It is not limited by the number of panels in a supported
installation.

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

## Safe optimization sequence

1. Add observable browser render, upload, relay, and dropped-frame counters.
2. Align browser generation and upload with the current 25 FPS relay.
3. Add an optional binary frame endpoint to reduce JSON bandwidth and parsing.
4. Trial a synchronized 25 ms cadence for 40 FPS with packet-loss and thermal
   monitoring.
5. Keep adaptive fallback to 25 or 20 FPS when upload latency or dropped frames
   cross a defined threshold.

The 40 FPS trial requires deliberate physical-display validation, so it was not
performed during the hardware-isolated feature work documented here.

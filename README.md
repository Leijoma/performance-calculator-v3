# performance-calculator-v3

Signal K plugin that computes sailing-performance data in software — true wind triangle, leeway, set & drift, polar targets and VMG — with mast-motion correction for apparent wind, four selectable smoothing algorithms, and an optional NMEA 2000 broadcast that emits the results using the same **PGN layout** as B&G's H5000 CPU. That means any MFD or instrument display that already knows how to render H5000 data will render these values too — no MFD-side config, no plugin on the plotter needed.

Written and tuned for a **Sirena 370** setup but the calculation is generic — swap `polar_SY370_clean.csv` for your own polar file and it works with any monohull.

> **This plugin does not impersonate or emulate any B&G / Navico product on the bus.** It claims a generic unknown-vendor NMEA 2000 identity. Nothing here uses B&G trademarks, model IDs, manufacturer codes, or serial numbers. What we borrow is publicly-documented technique (formulas from the H5000 manual) and public PGN layout (data-IDs inside PGN 130824) — everything else is our own.

## What it computes

Consumes standard Signal K paths (AWA, AWS, STW, SOG, heading, COG, attitude) and produces:

- **True wind** — TWS, TWD, TWA — full vector triangle
- **Leeway** — `K · heel / STW²`, clamped to configurable max
- **Set & drift** — from STW/heading vs SOG/COG
- **Polar performance** — target TWA, target boat speed, polar %, VMG
- **Apparent wind, mast-corrected** — subtracts the wind component induced by roll/pitch rotation at the masthead (needs an IMU that publishes `attitude.rollRate` / `.pitchRate`; on my boat that's an MPU-6050 via `signalk-mpu6050-attitude`)

## What it broadcasts on N2K

If `emulateN2K` is on (default), the plugin claims its own N2K address (default 138) as a generic navigation-display device and broadcasts the calculated values via **PGN 130824** with per-parameter data-IDs matching the H5000 layout — polar %, target TWA, target boat speed, VMG, corrected wind, tidal set/drift, leeway. MFDs that consume H5000 values pick these up automatically.

Identity on the bus:

| Field | Value |
|---|---|
| Manufacturer Code | 999 (reserved / unknown) |
| Device Function | 130 (Navigation Display) |
| Device Class | Display |
| Model ID | `SK Perf-Calc` |

Turn off with `emulateN2K: false` if you only want the results as Signal K deltas.

## Screenshots / webapp

Bundled webapp at `/performance-calculator-v3/webapp/index.html` — polar viewer, live calibration, smoothing tuning, mast-correction toggle. Built with React + MUI + Tailwind via esbuild.

## Data smoothing

Four algorithms selectable per data type (wind / boat speed / attitude / etc.):

- **Passthrough** — off
- **Exponential** — configurable time constant τ (ms). Simple, low CPU
- **Moving average** — configurable window size
- **Kalman** — configurable Q (process noise) and R (measurement noise)

Configured under **Plugin Config → Data Smoothing** in the Signal K admin UI. Off by default; turn it on only if your sensors are actually noisy.

## Requirements

- Signal K Server
- A polar file (`polar_SY370_clean.csv` shipped as example; format is a TWA × TWS grid, first row = wind speeds in knots, first column = TWA in degrees, cells = expected boat speed in knots)
- Optional but recommended: an IMU on the boat publishing attitude + rates (any that writes to `navigation.attitude.rollRate` / `.pitchRate`)
- Optional: `can0` interface up if you want the N2K broadcast on

## Installation

Not published to npm. Clone and reference via `file:` in your `~/.signalk/package.json`:

```json
{
  "dependencies": {
    "performance-calculator-v3": "file:../my_signalk_plugins/performance-calculator-v3"
  }
}
```

Then `npm install --prefix ~/.signalk` and enable in the admin UI.

## Configuration

All paths configurable in the plugin schema — defaults match standard Signal K path conventions. Key knobs:

| Option | Default | Purpose |
|---|---|---|
| `polarFile` | `./polar_SY370_clean.csv` | Path to your polar CSV |
| `useSTW` | true | Base wind triangle on STW (recommended) rather than SOG |
| `leewayCoefficient` | 0.05 | Leeway K constant |
| `maxLeeway` | 15° | Clamp leeway angle |
| `mastHeight` | 15 m | Height of wind sensor above deck (for mast-motion correction) |
| `enableMastCorrection` | true | Correct AWA/AWS for masthead motion |
| `engineRpmThreshold` | 10 Hz (600 RPM) | Above this, engine is considered running (affects performance metrics) |
| `emulateN2K` | true | Broadcast computed values on N2K |
| `n2kSourceAddress` | 138 | Preferred N2K address for the emulated device |

## Known issue: N2K broadcast is off by default

The `emulateN2K` option is **shipped disabled**. On this platform (Raspberry Pi 5 with an mcp251x SPI CAN HAT, running signalk-server's own canbus provider on can0) I have not managed to get PGN 130824 reliably out on the bus from plugin scope — regardless of transport strategy:

- **Own Canbus with private EventEmitter** (the navico-bridge pattern) — CanDevice's cansend never flips true; PGN 130824 fast-packet frames report `channel.send() → ret=16` but never appear on the wire; single-frame PGN 65305 keep-alive does go out.
- **SimpleCan sharing signalk-server's app** — same fast-packet drop, plus a CanDevice address-claim storm at ~1200 PGN 60928/s that swamps the bus and knocks slow sensors (wind, depth) offline.
- **`app.emit('nmea2000out', str)`** (the pattern signalk-raymarine-st1-pilot uses successfully) — signalk-server's own canbus provider then reports its cansend=false and rejects our sends, even though the same server sends other plugins' PGNs (126720 from raymarine-st1) fine at the same moment.

Root cause is somewhere in the interaction of canboatjs's CanDevice, the socketcan loopback (`ECHO` flag on can0), and the multiple in-process senders. The Signal K deltas the plugin publishes (`performance.polarSpeed`, `.polarSpeedRatio`, `.velocityMadeGood`, `.targetAngle`, `environment.wind.speedTrue`, etc.) are unaffected — every Signal K client (KIP, Freeboard-SK, WilhelmSK, etc.) sees them normally. Only the H5000-compatible N2K broadcast for MFDs is missing.

If you want to try enabling it on different hardware (e.g. an Actisense NGT or USB gs_usb adapter, which have very different socketcan behaviour), flip `emulateN2K` back on in Plugin Config and watch for the failure modes above. If it works for you, please open an issue with your hardware details.

## Heads-up for Raspberry Pi + SPI CAN HAT users

Unrelated to the above — if `emulateN2K` is on **and** works cleanly for you, the device may still appear in your MFD's device list without model name and serial number. That's a kernel `can0` TX-queue-too-small problem (default `qlen 10` can't hold a 20-frame PGN 126996 Product Info broadcast). Raise it with `sudo ip link set can0 txqueuelen 128` and make it persistent alongside your `ip link set can0 up` invocation.

## License

MIT — see [LICENSE](LICENSE).

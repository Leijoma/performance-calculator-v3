# performance-calculator-v3

Signal K plugin that emulates a **B&G H5000 performance calculator** in software — true wind triangle, leeway, set & drift, polar targets and VMG — with mast-movement correction for apparent wind, four selectable smoothing algorithms, and an optional H5000 N2K emulator that broadcasts the computed values back onto the NMEA 2000 bus so any B&G MFD / Triton / Zeus can consume them like a real H5000 CPU.

Written for a **Sirena 370** setup but the calculation is generic — swap `polar_SY370_clean.csv` for your own polar file and it works with any monohull.

## What it computes

Consumes standard Signal K paths (AWA, AWS, STW, SOG, heading, COG, attitude) and produces:

- **True wind** — TWS, TWD, TWA — full vector triangle per the H5000 manual
- **Leeway** — H5000 formula `K · heel / STW²`, clamped to configurable max
- **Set & drift** — from STW/heading vs SOG/COG
- **Polar performance** — target TWA, target boat speed, polar %, VMG
- **Apparent wind, mast-corrected** — subtracts the wind component induced by roll/pitch rotation at the masthead (needs an IMU that publishes `attitude.rollRate` / `.pitchRate`; on my boat that's an MPU-6050 via `signalk-mpu6050-attitude`)

## What it broadcasts on N2K

If `emulateN2K` is on (default), the plugin claims its own N2K address (default 138) as a Simrad/Navico device and re-broadcasts the calculated values via the same PGNs an H5000 CPU would emit. This makes computed target-TWA, polar %, and corrected wind visible on any B&G / Simrad MFD without them knowing there's no real H5000 on the bus.

## Screenshots / webapp

Bundled webapp at `/performance-calculator-v3/webapp/index.html` — polar viewer, live calibration, smoothing tuning, mast-correction toggle. Built with React + MUI + Tailwind via esbuild.

## Data smoothing

Four algorithms selectable per data type (wind / boat speed / attitude / etc.):

- **Passthrough** — off
- **Exponential** — configurable time constant τ (ms). Simple, low CPU, one tunable
- **Moving average** — configurable window size
- **Kalman** — configurable Q (process noise) and R (measurement noise)

Configured under **Plugin Config → Data Smoothing** in the Signal K admin UI. Off by default; turn it on only if your sensors are actually noisy.

## Requirements

- Signal K Server
- A polar file (`polar_SY370_clean.csv` shipped as example; format is a TWA × TWS grid, first row = wind speeds in knots, first column = TWA in degrees, cells = expected boat speed in knots)
- Optional but recommended: an IMU on the boat publishing attitude + rates (any that writes to `navigation.attitude.rollRate` / `.pitchRate`)
- Optional: `can0` interface up if you want the N2K emulator on

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
| `leewayCoefficient` | 0.05 | H5000 K constant |
| `maxLeeway` | 15° | Clamp leeway angle |
| `mastHeight` | 15 m | Height of wind sensor above deck (for mast-motion correction) |
| `enableMastCorrection` | true | Correct AWA/AWS for masthead motion |
| `engineRpmThreshold` | 10 Hz (600 RPM) | Above this, engine is considered running (affects performance metrics) |
| `emulateN2K` | true | Broadcast computed values on N2K as an H5000 device |
| `n2kSourceAddress` | 138 | Preferred N2K address for the emulated H5000 |

## Notes on the N2K emulator

Uses canboatjs `SimpleCan` to claim an address and broadcast standard performance PGNs. Uses `@canboat/canboatjs@^2.0.0` from its own `node_modules/` — bundled, not shared with the server's canboatjs.

**Heads-up for Raspberry Pi + SPI CAN HAT users:** if the H5000 emulator appears in your MFD's device list without model name and serial number, that's not this plugin — it's the kernel `can0` TX-queue default (`qlen 10`) being too small to buffer a 20-frame PGN 126996 broadcast. Raise it with `sudo ip link set can0 txqueuelen 128` and make it persistent alongside your `ip link set can0 up` invocation. See [this note](https://github.com/magnusleijonborg/performance-calculator-v3/issues/1) for the full story.

## License

MIT — see [LICENSE](LICENSE).

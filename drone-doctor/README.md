# Drone Doctor Web

Static browser version of the Drone Doctor Android monitor. It keeps the app's welcome screen, 4/6/8-arm identification, arm-by-arm condition view, Monitor / Events / Settings sections, freshness timeout, fault simulation, session history and JSON export.

## Run it

The site has no build step or server-side dependencies. For a quick local preview, run a static web server from this folder:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The demo works locally. For installability and Bluetooth permissions, publish the site over HTTPS.

## Live connections

The website supports two receive-only serial paths through Web Serial on supported desktop Chrome / Edge browsers:

- **Bluetooth SPP:** Pair the Bluetooth Classic base station in the computer's Bluetooth settings, then press **Connect via Bluetooth** and choose its SPP port. Bluetooth SPP does not use a physical UART baud rate; the baud selector is ignored by the Bluetooth link.
- **LoRa board over USB:** Connect the board with a data-capable USB cable, press **Connect LoRa board via USB**, choose its USB serial port, and set the baud rate to match the board firmware.

Both paths expect the board/base station to forward one complete UTF-8 JSON object followed by a newline (`\n`) using the Drone Doctor protocol v1. The browser requires HTTPS or localhost and asks the user to select the serial device. The page only reads data and sends no commands. Live serial connections are not available in most mobile browsers; use the Android app for live Bluetooth SPP or the website's simulated demo.

## Message format

The base station must forward one complete UTF-8 JSON object followed by a newline (`\n`). Protocol version 1 is documented in the Android project's `docs/PROTOCOL.md`. This website validates the required fields, arm identifiers, fault flags, modes, sequence ordering and data age. It accepts both `telemetry` and `base_status` packets.

The site displays detector results. It does not run the ANFIS/fault classifier or infer faults from raw sensor signals. The demo is labelled simulated and does not control an aircraft.

## Publish

This folder is a static site and can be published on GitHub Pages or another HTTPS static host. For GitHub Pages, create or choose a repository for the web edition, place these files at the published site root, then enable Pages for the repository's branch. The `manifest.webmanifest` and service worker make the page installable/offline-capable after its first secure load in compatible browsers.


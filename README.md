# Companion module — Waves LV1

[Bitfocus Companion](https://bitfocus.io/companion) module for controlling the
[Waves LV1](https://www.waves.com/mixers-racks/lv1-live-mixer) digital mixer
over its native OSC-over-TCP protocol.

Built on a complete reverse-engineering of the iPad MyFOH and iPhone MyMon
apps plus the PC-side `MyMonService.dll` — every supported `/Set/…` action
has been verified byte-for-byte against live captured traffic.

## Quick start

Nothing needs to be installed on the LV1 machine — no plugin, driver, OSC relay
or script. This module speaks the same protocol as the official iPad **MyFOH**
app, so the desk already knows how to talk to it. Just make sure **eMotion LV1
is running** and Companion is on the same network.

1. Add the **Waves: LV1** connection in Companion.
2. Open its config, wait a few seconds, then **close and reopen it** — the scan
   runs in the background, and reopening is what shows the results.
3. Pick your mixer from **Discovered LV1** and save.

**Dropdown empty?** You don't need discovery. Type the LV1's IP into **LV1 IP
(override)** and leave **LV1 port at `0`** — port `0` means "find it yourself",
which also works across VLANs, over VPN, and in Docker.

> ⚠️ Never hard-code the port: the LV1 picks a new control port every time
> eMotion LV1 launches, and again on every mixer-mode change. Left at `0`, the
> module re-finds it automatically.

If it doesn't connect, open Companion's log with Info messages enabled — the
module names every network interface it scanned and reports why it failed. Full
troubleshooting table in [`companion/HELP.md`](companion/HELP.md).

## Features at a glance

| Domain         | What you get                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Auto-discovery | Custom Waves `/zDNS` multicast — finds the LV1 on the LAN with no config                                 |
| Mute / Solo    | Any track (Input / Group / Aux / LR / C / M / Matrix / Cue / TB / DCA), with optimistic local feedback   |
| Faders         | Set / fade (linear ramp in dB, 0-60 s, cancellable), per-track + per-send                                |
| Pan & Width    | Channel pan, stereo width, send pan                                                                      |
| Sends          | On / Off / Toggle / gain / pan, with focus-an-aux (`/Set/AuxId`)                                         |
| Preamp         | Input gain, digital trim, +48 V, polarity                                                                |
| Plugins        | Enable / disable EQ / Filter / Comp / DeEsser / Dyn / Gate / Leveler / Limiter                           |
| EQ             | Bands 1-6 freq / gain / Q                                                                                |
| Scenes         | Recall by name (dropdown), by index, next / previous                                                     |
| Surface        | User keys (1-16), mute groups (1-8), tap tempo, rename                                                   |
| Feedbacks      | Live mirror of mute / solo / send-on / mute-group / scene + meter > threshold + channel color            |
| Variables      | Per-track name / mute / solo / gain / color; per-scene name; global tempo, scene index/name, mute groups |
| Raw            | Send any OSC address with typed args for what's not yet wrapped                                          |

See `companion/HELP.md` for the full reference.

## Protocol highlights

- **Custom 8-byte framing** per OSC packet (`[4B BE size][8B header][N bytes
OSC]`). Plain OSC clients fail silently.
- **`/ping`/`/pong` keepalive** at ~1 Hz. The module's TCP client auto-pongs.
- **Two valid handshakes** — `MyFOH` (one TCP write batching
  `/handshake [1,-1,1]` + `/device_name`) or `MyMon`
  (`/Get/Aux/Tracks` + `/YourHostIP` first, then sequenced handshake). The
  module uses MyFOH.
- **Bulk track names via `/Channels`** — the LV1 spontaneously broadcasts
  the full topology with names after every handshake. This is what lets the
  picker dropdowns label tracks correctly across module restarts.
- **Mixer-mode changes** (16 → 32 → 64 → 80 ch and aux variants) trigger a
  LV1 port change; the module re-discovers and re-handshakes automatically
  with no user intervention.

## Building

Requires **Node 22+** and **Yarn 4** (managed via Corepack):

```bash
corepack enable
yarn install
yarn build
```

Output goes to `dist/`. To test in Companion locally, point Companion's
"Developer modules path" at this folder (or copy into
`~/companion/modules-local/`).

```bash
yarn dev          # tsc --watch
yarn lint
yarn package      # build + companion-module-build for distribution
```

## Repository layout

```
companion/
  manifest.json      # Companion module metadata
  HELP.md            # in-app help shown to users
src/
  main.ts            # InstanceBase entrypoint, /Notify/... state handler
  actions.ts         # action definitions (the buttons you bind)
  feedbacks.ts       # boolean/advanced feedback definitions
  variables.ts       # exposed text variables
  presets.ts         # starter button templates
  config.ts          # config dialog fields
  tracks.ts          # track-picker helpers (group + per-group ch dropdowns)
  osc.ts             # minimal OSC encoder/decoder
  osc-tcp.ts         # framed TCP client + handshake + auto-pong
  zdns-discover.ts   # custom Waves multicast discovery
  discovery-cache.ts # one-shot scan + dedup
  upgrades.ts        # forward-compat scripts
```

## Disclaimer

Community-built module. Not affiliated with, endorsed by, or supported by
Waves Audio Ltd. Built by analysing public network traffic from the official
MyFOH / MyMon apps and the bundled `MyMonService.dll`.

## License

[MIT](LICENSE)

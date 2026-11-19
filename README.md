# Companion module — Waves LV1

[Bitfocus Companion](https://bitfocus.io/companion) module for controlling the
[Waves LV1](https://www.waves.com/mixers-racks/lv1-live-mixer) digital mixer
(eMotion LV1) over the network.

> **Version 2.x needs Companion 5.0 or newer.** On Companion 4.x, use **1.2.1**.

## Two ways to connect

Pick one in the connection settings, **Connect through**:

|                     | **MyRemote**                                             | **Companion Surface**                                                                                                           |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| What it is          | The protocol of Waves' MyFOH / MyMon apps (OSC over TCP) | A control-surface driver that runs inside eMotion LV1, like Waves' own LV1 Control and Mackie drivers                           |
| Install on the desk | Nothing                                                  | The driver, from a page served by this module (Windows and macOS)                                                               |
| Reach               | What MyRemote exposes                                    | Everything MyRemote mode does, plus flips without a page change, plugins and racks, every eMotion shortcut function, VU meters… |

Both are maintained. Existing connections stay on MyRemote.

## Quick start: MyRemote

Nothing needs to be installed on the LV1 machine. This module speaks the same
protocol as the official iPad **MyFOH** app, so the desk already knows how to
talk to it. Just make sure **eMotion LV1 is running** and Companion is on the
same network.

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

## Quick start: Companion Surface

1. Set **Connect through** to **Companion Surface**.
2. On the computer that runs eMotion LV1, open the link shown in the settings
   (`http://<Companion IP>:8000/instance/<connection label>/surface`). The page
   works without internet and offers both installers:
   - **Windows** 10 / 11 (x64): `CompanionSurface-Setup.exe`. Not signed: _More info → Run anyway_.
   - **macOS** 11 or newer (Intel and Apple Silicon): `CompanionSurface-Setup.pkg`. Not signed by
     Apple: _System Settings → Privacy & Security → Open Anyway_.
3. Close eMotion, run the installer, start eMotion, open the **Controls** panel,
   add **Companion Surface** and save. Its tile shows **ON** when Companion is connected.
4. Back in Companion, pick the desk in **Discovered LV1** (or leave it on
   **Automatic**) and save. Type its IP only for routed networks, VPN or Docker.

The driver listens on TCP port 9460 (optional password, set on both sides).
MyRemote is not used in this mode and doesn't need to be enabled. When the
driver on the desk is older than the one in the module, the connection status
says so: install it again from the same page.

## Features at a glance

### MyRemote mode

| Domain         | What you get                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Auto-discovery | Custom Waves `/zDNS` multicast — finds the LV1 on the LAN with no config                                 |
| Mute / Solo    | Any track (Input / Group / Aux / LR / C / M / Matrix / Cue / TB / DCA), with optimistic local feedback   |
| Faders         | Set / fade (linear ramp in dB, 0-60 s, cancellable), per-track + per-send                                |
| Pan & Width    | Channel pan, stereo width, stereo balance, send pan                                                      |
| Sends          | On / Off / Toggle / gain / pan, with focus-an-aux (`/Set/AuxId`)                                         |
| Preamp         | Input gain, digital trim, +48 V, polarity                                                                |
| Plugins        | Enable / disable EQ / Filter / Comp / DeEsser / Dyn / Gate / Leveler / Limiter                           |
| EQ             | Bands 1-6 freq / gain / Q                                                                                |
| Scenes         | Recall by name (dropdown), by index, next / previous                                                     |
| Surface        | User keys (1-16), mute groups (1-8), tap tempo, rename                                                   |
| Feedbacks      | Live mirror of mute / solo / send-on / mute-group / scene + meter > threshold + channel color            |
| Variables      | Per-track name / mute / solo / gain / color; per-scene name; global tempo, scene index/name, mute groups |
| Routing        | Patch > Internal route on / off / toggle + feedback (eMotion LV1 v17+)                                   |
| eMotion v17    | v16 and v17 handled automatically — Monitor buses, 16 DCA/Links, 16 groups; experimental I/O patch       |
| Raw            | Send any OSC address with typed args for what's not yet wrapped                                          |

### Companion Surface mode

Every action has a feedback that follows changes made on the desk; presets are built from what the
desk reports and their names follow it live.

| Domain    | What you get                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| Strips    | Channels, groups, FX and Monitor buses, matrices, links, LR, Center, Mono: fader in dB with fades, mute, solo   |
| Mutes     | Desk-style mute feedback (blinks when muted by a mute group, Mute All or a Link), Mute All, mute groups         |
| Flips     | Sends on fader to any FX / Monitor send, for Mixer 1, Mixer 2 and the All page; eMotion keeps its page          |
| Pan       | Pan / balance, stereo width and rotation of any strip, with fades                                               |
| Sends     | To FX and Monitor buses: on / off, level in dB with fades, pan                                                  |
| Talk Back | TALK, the Talk Back presets and the destinations, as in eMotion's panel                                         |
| Input     | Preamp gain, +48 V, digital trim and polarity (on the input bank each channel uses)                             |
| Plugins   | Any parameter of any plugin in a rack, by plugin and parameter name, with fades; slot bypass 1-8; rack In / Out |
| eMotion   | Every shortcut function (scenes, lock, clear solo, tap tempo, recording, save session, navigation…)             |
| Scenes    | Recall by name from the session's list, a button per scene; Spill for Mixer 1 / 2; renaming a strip             |
| Routes    | Internal routes: group buses, Links (DCA), mute group membership, LR / Center / Mono, matrices                  |
| User keys | MyRemote's 16 user keys, with their label and function as variables                                             |
| Colours   | eMotion's track colours on the buttons                                                                          |
| Keyboard  | Ctrl / Alt / Shift held on the eMotion computer (Windows), momentary or toggle                                  |
| Meters    | VU level 0-100 for a Gauge element; flip presets carry one                                                      |
| Variables | Like MyRemote mode: names, faders, mutes, solos, pan, colours, input section, scenes, mute groups, flips, page, |
|           | layer, eMotion version, user keys; VU for every strip as an option                                              |

The driver also adds a few things to eMotion itself, each one optional in its
settings window: an image per session while eMotion is locked, Ctrl + Alt + drag
on a pan knob for the rotation, and holding Ctrl / Ctrl + Alt on the Mixer pages
to see every stereo strip's width / rotation (on macOS: Control and Option).

See [`companion/HELP.md`](companion/HELP.md) for the full reference.

## Why this package contains an .exe and a .pkg

`surface/CompanionSurface-Setup.exe` (Windows) and `surface/CompanionSurface-Setup.pkg`
(macOS) are the installers of the Companion Surface driver. The driver has to be
installed on the computer that runs eMotion LV1, which is usually not the
Companion machine and is often offline at FOH, so the module carries both
installers (`build-config.cjs`, `extraFiles`) and serves them from its own HTTP
handler. The files travel base64-encoded inside that page, because Companion's
HTTP bridge only carries text. Companion and the module never run them; they are
only offered as downloads. MyRemote mode does not need them.

## Protocol highlights (MyRemote)

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

Companion Surface uses its own text protocol over TCP, one line per message;
see [`src/surface-client.ts`](src/surface-client.ts).

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
yarn test
yarn package      # build + companion-module-build for distribution (includes surface/)
```

The driver itself is built separately; its installers are committed in
`surface/` and its version is `SURFACE_DRIVER_VERSION` in `src/surface.ts`.

## Repository layout

```
companion/
  manifest.json        # Companion module metadata
  HELP.md              # in-app help shown to users
surface/               # Companion Surface installers (Windows .exe, macOS .pkg)
build-config.cjs       # ships surface/ with the package
src/
  main.ts              # InstanceBase entrypoint, both connection modes
  config.ts            # config dialog fields
  upgrades.ts          # upgrade scripts
  # MyRemote mode
  actions.ts           # action definitions
  feedbacks.ts         # boolean/advanced feedback definitions
  variables.ts         # exposed text variables
  presets.ts           # starter button templates
  tracks.ts            # track-picker helpers (group + per-group ch dropdowns)
  osc.ts               # minimal OSC encoder/decoder
  osc-tcp.ts           # framed TCP client + handshake + auto-pong
  zdns-discover.ts     # custom Waves multicast discovery
  discovery-cache.ts   # one-shot scan + dedup
  # Companion Surface mode
  surface.ts           # driver version, install page
  surface-client.ts    # TCP client for the driver
  surface-model.ts     # what the driver reported (tracks, flips, Talk Back)
  surface-actions.ts   # actions and feedbacks
  surface-features.ts  # strips, mutes, plugins, eMotion state
  surface-functions.ts # eMotion shortcut functions
  surface-presets.ts   # presets and variables
  surface-ui.ts        # shared option fields
tests/                 # node --test
```

## Disclaimer

Community-built module. Not affiliated with, endorsed by, or supported by
Waves Audio Ltd. MyRemote mode was built by analysing public network traffic
from the official MyFOH / MyMon apps and the bundled `MyMonService.dll`;
Companion Surface is a control-surface driver loaded by eMotion LV1 the same way
as Waves' own surface drivers.

## License

[MIT](LICENSE)

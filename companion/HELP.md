# Waves LV1 — Companion module

Control a Waves LV1 digital mixer over its native OSC-over-TCP protocol.
The module talks the **same wire-level protocol as the iPad MyFOH app**, so it
sees and changes the same state as the human-facing apps. No third-party OSC
relay or plugin needed on the LV1 PC.

## Setup

### Before you start

- **eMotion LV1 must be running** on the mixer machine.
- **Companion and the LV1 should be on the same subnet.** The LV1 announces
  itself by multicast, and multicast does not cross routers. (If they are not on
  the same subnet, that is fine — see "If the dropdown stays empty" below.)
- **There is nothing to install on the LV1 machine.** No plugin, no driver, no
  OSC relay, no script to download or run. This module speaks the _same_
  protocol as the official iPad **MyFOH** app, so the desk already knows how to
  talk to it.

> **Quick sanity check:** if the official MyFOH or MyMon app can reach your LV1
> from a phone or tablet on that network, this module will too. If MyFOH cannot
> connect either, the problem is on the LV1 or the network — fix that first,
> because Companion cannot work around it.

### Connecting

1. In Companion, add the **Waves: LV1** connection.
2. Open its config dialog, wait a few seconds, then **close and reopen it**.
   The scan runs in the background and the dialog only shows results that have
   already arrived — reopening is what displays them.
3. Pick your mixer from the **Discovered LV1** dropdown.
4. **Save.** The connection should go green, and the log should show
   `Registered with the LV1 as myfoh`.

There is nothing to configure about channel counts, aux counts or layers — the
module reads the whole topology from the desk on connect (`/Aux/Tracks`,
`/Notify/Layers`, and the `/Channels` bulk dump that carries all track names).

### If the dropdown stays empty

You do **not** need discovery to work. Enter the mixer's IP by hand:

1. Leave **Discovered LV1** on `— none discovered —`.
2. Type the LV1's IP address into **LV1 IP (override)**.
3. **Leave LV1 port at `0`.**
4. Save.

Port `0` means "find the port yourself". This works on routed networks, across
VLANs, over VPN, and when Companion runs in Docker — none of which pass
multicast.

> ⚠️ **Do not hard-code the port.** The LV1 picks a new control port **every
> time eMotion LV1 launches**, and changes it again when you switch mixer mode
> (16 → 32 → 64 → 80 ch). A port that works today will not work tomorrow. Left
> at `0`, the module re-finds it on every connect and recovers automatically
> after a mixer-mode change.

Once connected, the module appears on the desk as **TYPE = MyFOH**, device name
**`Companion`**, in MyRemote ControlPanel.

## If it doesn't connect

Open **Companion's log** and include Info messages. This module reports what it
is doing at each step, and the answer is almost always there.

| Log line                                                           | What it means                                                                                                          | What to do                                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Discovery listening on 225.1.1.1:13337 via en0 (192.168.1.50), …` | Working correctly. The line names **every interface being scanned**.                                                   | Check your LV1's subnet is one of those. A FOH machine often has Wi-Fi carrying the internet and Ethernet carrying the desk — if the desk's subnet is missing, use the manual-IP method. |
| `No LV1 announcements in 6 s. Listened on: …`                      | We listened correctly but heard nothing.                                                                               | The desk is on another subnet, eMotion LV1 is not running, or a firewall blocks UDP 13337. Use manual IP.                                                                                |
| `Discovery cannot listen on UDP 13337 … (EADDRINUSE)`              | Another process on the Companion machine holds that port — usually a second Companion instance or another LV1 utility. | Close it, or use the manual-IP method, which does not need that port at all.                                                                                                             |
| `TCP connect timed out after 5 s`                                  | Nothing answered at that address.                                                                                      | Check the IP, and that you can `ping` the LV1 from the Companion machine.                                                                                                                |
| `No /handshake ACK after 3 s`                                      | Something answered but is not an LV1.                                                                                  | Usually a stale hard-coded port now used by another service. Set the port back to `0`.                                                                                                   |

**Running Companion in Docker?** Multicast does not reach the container by
default, so the dropdown will always be empty. That is expected, not a bug — use
the manual-IP method and everything else works normally.

## What's controllable

### Mute / Solo

- **Channel: Mute / Unmute / Toggle** — any track (Input / Group / Aux / LR /
  Center / Mono / Matrix / Cue / TalkBack / DCA). Picker filters by group so
  LR shows just "Master", auxes show their real names ("Mon 1", "Fx 3").
- **Channel: Solo / Unsolo / Toggle** — same picker.
- **Mute Group: On / Off / Toggle** — 1-8.

### Faders

- **Channel: Set output fader (dB)** — instant set, any track.
- **Send: Set fader (dB)** — input channel → aux.
- **Fade: Smoothly ramp a fader to target dB** — channel out or send,
  duration 0-60 s, linear in dB (perceptually log). Triggering a new fade
  on the same target cancels the previous one.

### Pan & Width

- **Channel: Pan** (-1 left … +1 right)
- **Channel: Stereo width** (0 mono … 1 full)
- **Send: Pan**

### Sends

- **Send: On / Off / Toggle**
- **Aux: Focus (MyMon view)** — `/Set/AuxId`

### Talk Back

- **Talk Back: Engage to output** — sends the TalkBack mic (group 8) to a
  chosen aux output. ON sets Send/On=TRUE + Send/Gain=0 dB; OFF reverses.
  Only outputs that appear in the LV1's `/Aux/Tracks` list (FX + Mons) can
  receive TB this way — Group / Matrix / Main destinations are not exposed
  via OSC on the current Waves API.

### Surface / flip

- **Flip Sends: Trigger (via User Key)** — presses a User Key configured on
  the LV1 with the "Flip Sends" function. Assign the User Key on the LV1 first.
- **Spill: Press a Spill button** — expands a group / DCA onto the channel
  faders.
- **Solo: Clear All** — clears every solo on the desk.

### Preamp / processing

- **Preamp: Set input gain (dB)** (-10 to +60)
- **Channel: Digital trim (dB)** (-20 to +20)
- **Channel: +48 V on/off**
- **Channel: Polarity (phase) on/off**
- **Plugin section: Enable / Disable** — EQ / Filter / Compressor / De-Esser
  / Dynamics / Gate / Leveler / Limiter
- **EQ: Set band (Freq / Gain / Q)** — bands 1-6

### Surface / scenes / tempo

- **Scene: Recall (pick from list)** — dropdown with real scene names.
- **Scene: Recall by index** — for automation with calculated indices.
- **Scene: Next / Previous** — wraps at the ends.
- **User Key: Press (momentary) or Hold** — 1-16.
- **Tap Tempo** — one call = one tap. LV1 computes BPM.
- **Channel: Rename** — `/Set/TrackName`.

### Utilities

- **State: Re-request layers + aux tracks** — force a refresh.
- **Discovery: Scan for LV1s on the LAN** — manual rescan.
- **Raw: Send any OSC address** — typed-arg shorthand (`i:0 i:1 T`).

## Feedbacks

- **Channel muted** — paints button red.
- **Channel solo** — paints yellow.
- **Send ON to aux** — paints green.
- **Mute group active** — paints red.
- **Channel color (from LV1 GUI)** — applies the channel's strip color from
  the mixer to the button background.
- **Meter above threshold** — paints red when the meter (from
  `/Notify/Meters`, ~0.8 Hz) is at or above the threshold dB you pick.
- **Current scene index matches** — by numeric index.
- **Current scene matches (pick from list)** — by name.
- **Any track is soloed** — for a "Clear All Solo" button indicator.
- **Talk Back engaged to output** — paints red while TB is flowing to that aux.
- **Spill mode active** — for a specific Spill button.
- **Flip-to-faders active (any aux / specific aux)** — **requires "Aux Cue On
  Flip" enabled on the LV1**, otherwise the LV1 doesn't broadcast flip state
  over OSC and the feedback stays off.

## Variables

**Per track** (slug = `in1`, `aux9`, `lr`, `dca3`, `mtx2`, etc):

- `{slug}_name` — display name from the mixer
- `{slug}_mute` — `"on"` / `"off"`
- `{slug}_solo` — `"on"` / `"off"`
- `{slug}_gain` — fader in dB, e.g. `"-7.3"`
- `{slug}_color` — hex like `"#FF5500"`

**Globals:**

- `tempo` — BPM
- `scene_index` — current scene (0-based)
- `scene_name` — current scene name
- `scene_count` — total scenes
- `scene_1_name`, `scene_2_name`, … — name of each scene
- `channels_total`, `auxes_total` — detected counts
- `mg_1` … `mg_8` — mute group on/off

Use on a button: `$(lv1:in1_name)`, `$(lv1:scene_name)`, `$(lv1:aux9_gain)`.

## Auto-discovery

The LV1 broadcasts `/zDNS` on UDP multicast **`225.1.1.1:13337`**. Standard
mDNS / Bonjour does **not** work — Waves does not register through it. The
module joins the multicast group on every active network interface, so it
finds the LV1 regardless of which NIC it's on.

If multicast doesn't reach the Companion PC (different VLAN, AP isolation,
etc.), fill in the IP manually in the config.

## Adapting to mixer config changes

When you switch the LV1's "Mixer Configuration" (16 / 32 / 64 / 80 ch with
different aux counts), the LV1 reconnects all clients on a new port. The
module:

1. Detects the disconnect, runs a fresh discovery to find the new port.
2. Re-handshakes.
3. Reads the new `/Aux/Tracks` + `/Channels` + `/Notify/Layers`.
4. Regenerates all action/feedback dropdowns + variables.

You don't need to manually reconfigure anything when the LV1 mode changes.

## Troubleshooting

| Symptom                                         | Likely cause / fix                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No LV1 found on the LAN"                       | Companion PC isn't on the same broadcast domain as the LV1, or the "Waves Remote" service isn't running. Try the manual IP override.                                                                                      |
| Status orange `<~~~>` in MyRemote ControlPanel  | Cosmetic LV1 quirk — commands still take effect. The link only goes green after a "ready trigger" (`/GetEQ` for MyFOH style); not critical.                                                                               |
| Action does nothing                             | Module probably between configs. Toggle Enabled in Companion to reconnect.                                                                                                                                                |
| Mute toggle "feels wrong"                       | The LV1 doesn't echo `/Notify/...` to the client that originated the change. The module compensates with an optimistic local update; feedbacks reflect changes made by other clients (iPad, surface, etc.) within ~30 ms. |
| Channel names show as "Channel 1, Channel 2…"   | The LV1 has those as defaults — rename them in the mixer GUI and the new names propagate via `/Notify/Track/Name` and the next `/Channels` broadcast.                                                                     |
| Wrong channel changes when using the Raw action | The wire is 0-based; the module's pickers are 1-based. Subtract 1 when sending raw OSC.                                                                                                                                   |

## Disclaimer

Community module built by reverse-engineering the public network traffic of
the Waves MyFOH / MyMon apps and static analysis of `MyMonService.dll`.
Not affiliated with, endorsed by, or supported by Waves Audio Ltd.

## License

MIT — see `LICENSE`.

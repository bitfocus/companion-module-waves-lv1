# Waves LV1 — Companion module

Control a Waves LV1 digital mixer over its native OSC-over-TCP protocol.
The module talks the **same wire-level protocol as the iPad MyFOH app**, so it
sees and changes the same state as the human-facing apps. No third-party OSC
relay or plugin needed on the LV1 PC.

## Setup

1. Open the module config dialog.
2. The **Discovered LV1** dropdown lists every LV1 the module finds on the
   LAN. Pick yours. A fresh scan runs every time you open the dialog — close
   and reopen if you don't see your mixer yet.
3. Optional: if the LV1 is on a routed network (not reachable by multicast),
   fill in **LV1 IP (override)** manually. With **LV1 port = 0** the module
   still auto-discovers the port for that IP.
4. Save. The module registers as **TYPE = MyFOH**, device name **`Companion`**,
   in MyRemote ControlPanel.

No channel-count, aux-count, or topology settings — the module reads
everything from the LV1 on connect (`/Aux/Tracks`, `/Notify/Layers`, and the
`/Channels` bulk dump that carries all track names).

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

| Symptom | Likely cause / fix |
|---|---|
| "No LV1 found on the LAN" | Companion PC isn't on the same broadcast domain as the LV1, or the "Waves Remote" service isn't running. Try the manual IP override. |
| Status orange `<~~~>` in MyRemote ControlPanel | Cosmetic LV1 quirk — commands still take effect. The link only goes green after a "ready trigger" (`/GetEQ` for MyFOH style); not critical. |
| Action does nothing | Module probably between configs. Toggle Enabled in Companion to reconnect. |
| Mute toggle "feels wrong" | The LV1 doesn't echo `/Notify/...` to the client that originated the change. The module compensates with an optimistic local update; feedbacks reflect changes made by other clients (iPad, surface, etc.) within ~30 ms. |
| Channel names show as "Channel 1, Channel 2…" | The LV1 has those as defaults — rename them in the mixer GUI and the new names propagate via `/Notify/Track/Name` and the next `/Channels` broadcast. |
| Wrong channel changes when using the Raw action | The wire is 0-based; the module's pickers are 1-based. Subtract 1 when sending raw OSC. |

## Disclaimer

Community module built by reverse-engineering the public network traffic of
the Waves MyFOH / MyMon apps and static analysis of `MyMonService.dll`.
Not affiliated with, endorsed by, or supported by Waves Audio Ltd.

## License

MIT — see `LICENSE`.

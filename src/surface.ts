// Companion Surface: the driver that runs inside eMotion LV1 (see surface-client.ts) and
// the installer this module carries for it.

import fs from 'node:fs'
import path from 'node:path'
import type { ControlAddress } from './surface-client.js'

/** Version of the driver installer shipped with this module (surface/CompanionSurface-Setup.exe). */
export const SURFACE_DRIVER_VERSION = '0.1.9'
export const SURFACE_DEFAULT_PORT = 9460
export const SURFACE_INSTALLER = 'CompanionSurface-Setup.exe'

/** Controls verified in the eMotion UI (tt / track are the desk's track type / index). */
export const SurfaceControls = {
	/** Talk Back TALK button: 1 = talking. */
	talk: (): ControlAddress => ({ tt: 8, track: 0, group: 14, secType: -1, secIdx: -1, cid: 0 }),
	/** Plugin slot bypass in a strip's rack, slot 0-7: 1 = bypassed. */
	slotBypass: (tt: number, track: number, slot: number): ControlAddress => ({
		tt,
		track,
		group: 4,
		secType: slot,
		secIdx: -1,
		cid: 3,
	}),
	/** The whole plugin rack of a strip: 1 = In, 0 = Out. */
	rackIn: (tt: number, track: number): ControlAddress => ({ tt, track, group: 0, secType: -1, secIdx: -1, cid: 17 }),
}

/** Compare dotted versions: < 0 when a is older than b. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
	const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (d) return d
	}
	return 0
}

/** The installer next to the packaged module, or in surface/ when running from the repo. */
function findInstaller(): string | null {
	const manifest = process.env.MODULE_MANIFEST
	const roots = manifest ? [path.dirname(path.dirname(manifest))] : []
	roots.push(process.cwd())
	for (const root of roots) {
		for (const p of [path.join(root, SURFACE_INSTALLER), path.join(root, 'surface', SURFACE_INSTALLER)]) {
			if (fs.existsSync(p)) return p
		}
	}
	return null
}

let installPage: string | null = null

/**
 * HTML page that downloads the installer. Companion's HTTP bridge only carries text
 * bodies, so the installer travels base64-encoded inside the page and the browser turns
 * it back into a file. Works without internet access on the desk computer.
 */
export function surfaceInstallPage(): { status: number; body: string } {
	if (installPage) return { status: 200, body: installPage }
	const file = findInstaller()
	if (!file) return { status: 404, body: 'The Companion Surface installer is missing from this module package.' }
	const b64 = fs.readFileSync(file).toString('base64')
	installPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Companion Surface installer</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#1c1f24;--muted:#5d6470;--accent:#2f6fdb}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--card:#1f2228;--fg:#e8eaee;--muted:#9aa1ad;--accent:#5b8ff0}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:640px;margin:48px auto;padding:0 16px}
.card{background:var(--card);border-radius:10px;padding:24px 28px}
h1{font-size:22px;margin:0 0 4px}
p,li{color:var(--muted)}
button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:16px;cursor:pointer}
code{font-size:14px}
</style></head>
<body><main><div class="card">
<h1>Companion Surface for eMotion LV1</h1>
<p>Version ${SURFACE_DRIVER_VERSION} &middot; Windows</p>
<p><button id="dl">Download the installer</button></p>
<ol>
<li>Run the installer on the computer that runs eMotion LV1 (close eMotion first when updating).</li>
<li>Start eMotion LV1, open the <b>Controls</b> panel, add <b>Companion Surface</b> and save.</li>
<li>In Companion, set this connection to <b>Companion Surface</b>. It connects on TCP port <code>${SURFACE_DEFAULT_PORT}</code>.</li>
</ol>
</div></main>
<script>
const b64 = ${JSON.stringify(b64)};
document.getElementById('dl').onclick = () => {
	const bin = atob(b64), bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
	a.download = ${JSON.stringify(SURFACE_INSTALLER)};
	a.click();
};
</script></body></html>`
	return { status: 200, body: installPage }
}

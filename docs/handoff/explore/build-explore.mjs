import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Build one standalone HTML: the rolldown IIFE bundle plus the saved GLB as
// base64, so the file opens from disk with no server, no network, no key.
const dir = path.resolve("var/kiri-overnight/explore");
const glbPath = process.argv[2] ?? "var/kiri-overnight/photo/photo-ultra-mask-clean.glb";
const out = process.argv[3] ?? path.join(dir, "chair-explore.html");

const bundle = await readFile(path.join(dir, "bundle.js"), "utf8");
const glb = await readFile(path.resolve(glbPath));
const b64 = glb.toString("base64");

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kursi KIRI — penjelajah 3D</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: #0f120f; color: #e7ece4;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    display: flex; flex-direction: column;
  }
  header { padding: 18px 22px 12px; }
  h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: -0.01em; font-weight: 650; }
  header p { margin: 0; color: #9aa596; font-size: 13px; line-height: 1.5; max-width: 78ch; }
  header code { font-family: Consolas, monospace; font-size: 12px; background: #1c231c; padding: 1px 5px; border-radius: 4px; }
  main { flex: 1; display: flex; gap: 0; min-height: 0; }
  #stage { flex: 1; position: relative; min-height: 62vh; }
  #stage canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  #stage canvas:active { cursor: grabbing; }
  #hud[data-state="loading"]::after {
    content: "Menyiapkan model…"; position: absolute; inset: 0; display: grid; place-items: center;
    color: #8d978a; font-size: 14px;
  }
  aside {
    width: 268px; flex: none; border-left: 1px solid #222a22; background: #121612;
    padding: 16px 16px 20px; overflow-y: auto; font-size: 13px;
  }
  aside h2 { font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: #8b9587; margin: 0 0 8px; }
  group { display: block; margin-bottom: 18px; }
  .row { display: flex; gap: 6px; margin-bottom: 8px; }
  button {
    flex: 1; min-height: 36px; padding: 8px 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid #2d372c; background: #1a211a; color: #dfe6da; font-size: 12.5px;
    font-family: inherit;
  }
  button:hover { background: #212a20; }
  button[aria-pressed="true"] { border-color: #4f9d6a; background: #1d2b21; color: #a8e0bd; }
  label.check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: #c3ccbe; }
  input[type="range"] { width: 100%; accent-color: #4f9d6a; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; }
  dt { color: #8b9587; }
  dd { margin: 0; color: #e7ece4; font-variant-numeric: tabular-nums; }
  .note { margin-top: 14px; padding-top: 12px; border-top: 1px solid #222a22; color: #9aa596; line-height: 1.55; font-size: 12px; }
  .note strong { color: #d6e0d1; }
  #error:not(:empty) { margin: 12px; padding: 10px 12px; border: 1px solid #6b2b2b; border-radius: 8px; background: #2a1515; color: #f0c4c4; }
  @media (max-width: 760px) {
    main { flex-direction: column; }
    #stage { min-height: 56vh; }
    aside { width: auto; border-left: 0; border-top: 1px solid #222a22; }
  }
</style>
</head>
<body>
<header>
  <h1>Kursi hasil Photo Scan KIRI Engine — versi jelajah</h1>
  <p>Seret untuk memutar, cubit atau gulir untuk memperbesar. Model: <code>photo-ultra-mask-clean.glb</code>,
     21.769 segitiga, Photo Scan Ultra dengan masking otomatis dari 101 foto <code>golden-chair.mp4</code>.
     Berkas ini mandiri: Three.js dan modelnya tertanam, tanpa server dan tanpa kunci API.</p>
</header>
<main>
  <div id="stage" aria-label="Penampil model 3D kursi"><div id="hud" data-state="loading"></div></div>
  <aside>
    <group>
      <h2>Tampilan</h2>
      <div class="row">
        <button type="button" data-material="texture" aria-pressed="true">Tekstur</button>
        <button type="button" data-material="normals" aria-pressed="false">Normal</button>
      </div>
      <label class="check"><input id="wireframe" type="checkbox"> Wireframe</label>
      <label class="check"><input id="autorotate" type="checkbox"> Putar otomatis</label>
    </group>
    <group>
      <h2>Cahaya</h2>
      <input id="exposure" type="range" min="0.5" max="2.2" step="0.05" value="1.15" aria-label="Eksposur">
    </group>
    <group>
      <h2>Aksi</h2>
      <div class="row"><button type="button" id="reset">Reset sudut</button></div>
      <div class="row"><button type="button" id="save">Unduh PNG</button></div>
    </group>
    <group>
      <h2>Model</h2>
      <dl>
        <dt>Segitiga</dt><dd id="tris">—</dd>
        <dt>Tinggi</dt><dd id="height">—</dd>
        <dt>Berkas</dt><dd>2,3 MB GLB</dd>
        <dt>Serial</dt><dd>2156501d…</dd>
        <dt>Kredit</dt><dd>1 dari 10</dd>
      </dl>
      <p class="note"><strong>Cacatnya nyata, bukan bayangan:</strong> sandaran berlubang karena jaring tipis
        tembus cahaya tidak tertangkap kamera, kolom gas-lift tinggal selaput tipis sehingga dudukan tampak
        melayang, dan krom di kaki meleleh. Coba tombol <strong>Normal</strong> — lubangnya tetap ada, jadi
        permukaannya memang tidak dibangun.</p>
    </group>
  </aside>
</main>
<div id="error"></div>
<script>window.__CHAIR_GLB = "${b64}";</script>
<script>${bundle}</script>
</body>
</html>
`;

await writeFile(out, html);
console.log(JSON.stringify({ out, bytes: html.length, glbBytes: glb.length }, null, 1));

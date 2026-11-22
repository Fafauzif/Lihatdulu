import{t as e}from"./index-BAKqYOS8.js";var t=class extends Error{constructor(e,t,n=0,r=!1){super(t||`Terjadi kesalahan.`),this.name=`ScanApiError`,this.code=e,this.status=n,this.retryable=r}},n=Object.freeze([`uploading`,`submitting`,`queued`,`processing`,`downloading`,`converting`,`ready`]),r=Object.freeze({uploading:`Mengunggah video`,submitting:`Mengirim ke KIRI Engine`,queued:`Menunggu antrean KIRI`,processing:`KIRI memproses video`,downloading:`Mengunduh hasil`,converting:`Menyiapkan pratinjau 3D`,ready:`Selesai`,failed:`Berhenti`,expired:`Kedaluwarsa`}),i=Object.freeze([`ready`,`failed`,`expired`]),a=Object.freeze({video_too_large:`Video melebihi 200 MB. Pilih rekaman yang lebih pendek.`,video_too_long:`Video lebih dari 3 menit. Potong dulu menjadi satu putaran barang.`,video_too_large_dimensions:`Resolusi video di atas 1920×1080. KIRI hanya menerima sampai Full HD.`,video_not_mp4:`Berkas ini bukan MP4. Pilih video MP4 dari galeri.`,video_unreadable:`Video ini tidak bisa dibaca browser. Coba MP4 lain.`,upload_empty:`Berkas video kosong. Pilih video lain.`,missing_key:`Server demo belum diberi kunci KIRI. Hubungi operator.`,kiri_unauthorized:`Kunci KIRI ditolak. Operator perlu memeriksa KIRI_API_KEY.`,kiri_no_credit:`Kredit KIRI Engine habis. Operator perlu menambah kredit.`,kiri_rate_limited:`KIRI Engine sedang membatasi permintaan. Coba lagi sebentar.`,kiri_unavailable:`KIRI Engine tidak bisa dihubungi sekarang. Coba lagi.`,kiri_network:`Sambungan ke server terputus. Periksa jaringan lalu coba lagi.`,kiri_failed:`KIRI Engine gagal menyusun model dari video ini. Rekam ulang dengan lebih banyak sudut.`,kiri_expired:`Hasil ini sudah kedaluwarsa di KIRI Engine. Kirim video lagi.`,zip_invalid:`Berkas hasil dari KIRI tidak bisa dibaca. Coba proses ulang.`,ply_invalid:`Hasil KIRI bukan berkas splat 3D yang dikenali. Rekam ulang barangnya.`,ply_empty:`Hasil KIRI tidak berisi titik splat. Rekam ulang barangnya.`,convert_failed:`Konversi ke SPZ gagal di server. Coba proses ulang.`,spz_invalid:`Berkas SPZ hasil konversi rusak. Coba proses ulang.`,artifact_too_large:`Hasil 3D terlalu besar untuk dibuka di ponsel.`,submit_interrupted:`Server sempat berhenti saat mengirim video. Kirim ulang video ini.`,not_found:`Pekerjaan pindai tidak ditemukan.`,conflict:`Pekerjaan ini belum bisa dicoba ulang.`,network:`Sambungan terputus. Periksa jaringan lalu coba lagi.`,aborted:`Pengiriman dibatalkan.`,internal:`Terjadi kesalahan. Coba lagi.`,default:`Terjadi kesalahan. Coba lagi.`}),o=Object.freeze({title:`Ubah video barangmu menjadi model 3D.`,lede:`Pilih satu video MP4 yang sudah ada. Video dikirim ke KIRI Engine untuk diproses di cloud, lalu hasilnya bisa diputar di halaman ini.`,consent:`Saya setuju video ini dikirim ke KIRI Engine untuk diproses di cloud.`,submit:`Kirim ke KIRI Engine`,submitting:`Mengirim…`,pick:`Pilih video MP4`,change:`Ganti video`,openResult:`Buka hasil 3D`,another:`Pindai barang lain`,resend:`Kirim ulang video ini`,retry:`Coba proses ulang`,cloudNote:`Video diproses di server KIRI Engine, bukan di laptop ini. Satu kiriman memakai kredit KIRI milik operator.`,privacyNote:`Server hanya menyimpan berkas video sementara untuk dikirim, lalu menghapusnya. Simpan hasil 3D di server ini, bukan di KIRI.`,mockNote:`Mode simulasi aktif: KIRI tidak dihubungi, tidak ada kredit terpakai, dan model di halaman hasil dibuat secara lokal untuk menguji alur.`,unconfiguredNote:`Server belum diberi kunci KIRI, jadi pengiriman dinonaktifkan. Alur dan tampilan masih bisa diperiksa.`}),s=Object.freeze({badge:`Hasil pindai`,notFound:`Hasil pindai tidak ditemukan.`,notFoundNote:`Periksa tautannya, atau pindai barang baru dari halaman penjual.`,retake:`Pindai barang lain`,catalog:`Lihat katalog`,retry:`Coba proses ulang`,modelNote:`Model 3D ini berasal dari video yang diproses KIRI Engine, bukan contoh Sora.`,hint:`Tarik untuk memutar · cubit untuk memperbesar`}),c=`lihatdulu:kiri-job`,l=Object.freeze({maxUploadBytes:209715200,maxDurationS:180,maxWidth:1920,maxHeight:1080}),u=/\.mp4$/i;function d(e){return{ok:!1,code:e,message:a[e]??a.default}}function f({name:e=``,type:t=``,size:n=0}={},r=l){return u.test(e)||t===`video/mp4`?n?n>r.maxUploadBytes?d(`video_too_large`):{ok:!0,code:null,message:``}:d(`upload_empty`):d(`video_not_mp4`)}function p(e={},t=l){let n=f(e,t);if(!n.ok)return n;let{durationS:r=0,width:i=0,height:a=0}=e;return!Number.isFinite(r)||r<=0?d(`video_unreadable`):r>t.maxDurationS+1?d(`video_too_long`):i>t.maxWidth||a>t.maxHeight?d(`video_too_large_dimensions`):{ok:!0,code:null,message:``}}function m(e){let t=Number(e)||0;if(t<=0)return`0 MB`;if(t<1048576)return`${Math.max(1,Math.round(t/1024))} KB`;let n=t/1048576;return`${n.toFixed(n>=10?0:1).replace(`.`,`,`)} MB`}function h(e){let t=Math.max(0,Math.round(Number(e)||0)),n=Math.floor(t/60),r=t%60;return n?`${n} mnt ${String(r).padStart(2,`0`)} dtk`:`${r} dtk`}function g(e){if(!e)return`—`;let t=new Date(e);return Number.isNaN(t.getTime())?`—`:new Intl.DateTimeFormat(`id-ID`,{dateStyle:`medium`,timeStyle:`short`}).format(t)}function _(e){let t=[1500,2e3,3e3,5e3,8e3];return t[Math.min(t.length-1,Math.max(0,Number(e)||0))]}function v(e){return i.includes(e)}function y(e){let t=n.indexOf(e);return t===-1?0:t}function b(e,t){return a[e]??t??a.default}function x(e){try{let t=e?.getItem(c);return typeof t==`string`&&/^[0-9a-f-]{36}$/.test(t)?t:null}catch{return null}}function S(e,t){try{t?e?.setItem(c,t):e?.removeItem(c)}catch{}}async function C(e){let n=null;try{n=await e.json()}catch{n=null}let r=n?.error;return new t(r?.code??`internal`,r?.message,e.status,r?.retryable===!0)}async function w({signal:e}={}){let n;try{n=await fetch(`/api/kiri/config`,{signal:e,headers:{accept:`application/json`}})}catch{throw new t(`network`,a.network)}if(!n.ok)throw await C(n);return n.json()}async function T(e,{signal:n}={}){let r;try{r=await fetch(`/api/kiri/jobs/${encodeURIComponent(e)}`,{signal:n,headers:{accept:`application/json`}})}catch(e){throw e?.name===`AbortError`?e:new t(`network`,a.network)}if(!r.ok)throw await C(r);return r.json()}async function E(e){let n;try{n=await fetch(`/api/kiri/jobs/${encodeURIComponent(e)}/retry`,{method:`POST`,headers:{accept:`application/json`}})}catch{throw new t(`network`,a.network)}if(!n.ok)throw await C(n);return n.json()}function D(e,{onProgress:n=()=>{},signal:r}={}){return new Promise((i,o)=>{let s=new XMLHttpRequest;s.open(`POST`,`/api/kiri/jobs`),s.responseType=`json`,s.setRequestHeader(`content-type`,e.type||`video/mp4`),s.setRequestHeader(`x-file-name`,encodeURIComponent(e.name||`video.mp4`)),s.upload.addEventListener(`progress`,e=>{e.lengthComputable&&e.total>0&&n(Math.min(.99,e.loaded/e.total))}),s.addEventListener(`load`,()=>{let e=s.response??(()=>{try{return JSON.parse(s.responseText)}catch{return null}})();if(s.status>=200&&s.status<300){n(1),i(e);return}let r=e?.error;o(new t(r?.code??`internal`,r?.message,s.status,r?.retryable===!0))}),s.addEventListener(`error`,()=>o(new t(`network`,a.network))),s.addEventListener(`abort`,()=>o(new t(`aborted`,a.aborted))),r?.addEventListener(`abort`,()=>s.abort(),{once:!0}),s.send(e)})}var O=Object.freeze({uploading:`Mengunggah video…`,submitting:`Mengirim ke KIRI Engine…`,queued:`Menunggu antrean KIRI…`,processing:`KIRI memproses video…`,downloading:`Mengunduh hasil…`,converting:`Menyiapkan pratinjau 3D…`,ready:`Model 3D siap`,failed:`Pemrosesan berhenti`,expired:`Hasil kedaluwarsa`});function k(){return n.map(e=>`<li data-scan-stage="${e}"><span aria-hidden="true"></span>${r[e]}</li>`).join(``)}function A(){let t=m(l.maxUploadBytes);return`
  <section class="scan-upload" data-scan-upload>
    <header class="scan-upload-head">
      <p class="scan-eyebrow">Pindai furnitur · KIRI Engine</p>
      <h1>${o.title}</h1>
      <p class="scan-lede">${o.lede}</p>
      <p class="scan-mode" data-scan-mode hidden></p>
    </header>

    <div class="scan-upload-grid">
      <section class="scan-panel" data-scan-picker>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">1</span>
          <h2>Pilih video MP4</h2>
        </div>
        <p class="scan-panel-note">Satu video untuk satu barang. Rekam 30–60 detik sambil berjalan mengelilingi barang.</p>
        <input class="scan-file-input" data-scan-input type="file" accept="video/mp4" hidden>
        <div class="scan-drop" data-scan-drop>
          <button type="button" class="scan-choose" data-scan-choose>${e(`film`)} ${o.pick}</button>
          <p>atau seret berkas MP4 ke sini</p>
        </div>
        <figure class="scan-media" data-scan-media hidden>
          <video data-scan-video controls playsinline muted preload="metadata"></video>
          <figcaption data-scan-facts></figcaption>
        </figure>
        <p class="scan-field-error" data-scan-file-error role="alert" hidden></p>
        <button type="button" class="scan-link-button" data-scan-change hidden>${o.change}</button>
      </section>

      <section class="scan-panel" data-scan-confirm>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">2</span>
          <h2>Setujui pengiriman</h2>
        </div>
        <ul class="scan-facts">
          <li><strong>Diproses di cloud.</strong> ${o.cloudNote}</li>
          <li><strong>Butuh kredit.</strong> Setiap kiriman memakai kredit KIRI milik operator demo.</li>
          <li><strong>Batas KIRI.</strong> MP4 sampai ${t}, ${l.maxDurationS/60} menit, maksimal 1920×1080.</li>
          <li><strong>Penyimpanan.</strong> ${o.privacyNote}</li>
        </ul>
        <label class="scan-consent">
          <input type="checkbox" data-scan-consent>
          <span>${o.consent}</span>
        </label>
        <button type="button" class="scan-submit" data-scan-submit disabled>${o.submit}</button>
        <p class="scan-panel-note" data-scan-config-note hidden></p>
      </section>
    </div>

    <section class="scan-panel scan-job" data-scan-job hidden aria-live="polite">
      <div class="scan-job-head">
        <div>
          <p class="scan-eyebrow">Proses pindai</p>
          <h2 data-scan-job-title>Menunggu video</h2>
        </div>
        <span class="scan-job-badge" data-scan-job-badge hidden></span>
      </div>
      <p class="scan-mode" data-scan-job-mode hidden>${o.mockNote}</p>
      <ol class="scan-stages" data-scan-stages>${k()}</ol>
      <div class="scan-progress" data-scan-progress role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span data-scan-progress-bar></span>
      </div>
      <p class="scan-progress-label" data-scan-progress-label></p>
      <p class="scan-job-error" data-scan-job-error role="alert" hidden></p>
      <div class="scan-job-actions">
        <a class="scan-link-button primary" data-scan-open href="/jual/pindai" data-nav hidden>${o.openResult}</a>
        <button type="button" class="scan-link-button" data-scan-retry hidden>${o.retry}</button>
        <button type="button" class="scan-link-button" data-scan-resend hidden>${o.resend}</button>
        <button type="button" class="scan-link-button" data-scan-new hidden>${o.another}</button>
      </div>
      <p class="scan-panel-note" data-scan-job-note hidden></p>
    </section>
  </section>`}function j(){return`
  <section class="scan-preview" data-scan-preview>
    <header class="scan-preview-head">
      <p class="scan-preview-badge">${s.badge}</p>
      <h1 data-scan-title>Hasil pindai</h1>
      <p class="scan-preview-facts" data-scan-facts>Menyiapkan model 3D…</p>
      <p class="scan-preview-disclaimer" data-scan-provider></p>
    </header>
    <div class="scan-preview-grid">
      <div class="scan-preview-main">
        <div class="scan-viewer" data-scan-viewer data-state="idle">
          <p class="scan-viewer-placeholder" data-scan-viewer-placeholder>Menunggu model siap…</p>
        </div>
        <p class="scan-viewer-hint-line">${s.hint}</p>
      </div>
      <aside class="scan-preview-side">
        <section class="scan-card" data-scan-status>
          <h2>Proses</h2>
          <ol class="scan-stages" data-scan-stages>${k()}</ol>
          <p class="scan-card-note" data-scan-note>Memuat status pekerjaan…</p>
        </section>
        <section class="scan-card scan-provenance" data-scan-provenance hidden>
          <h2>Rincian hasil</h2>
          <dl data-scan-details></dl>
        </section>
        <section class="scan-card" data-scan-error hidden>
          <h2>Belum bisa dibuka</h2>
          <p class="scan-error" data-scan-error-text></p>
          <div class="scan-retry">
            <button type="button" class="scan-link-button" data-scan-retry hidden>${s.retry}</button>
          </div>
        </section>
        <div class="scan-preview-actions">
          <a class="scan-link-button primary" href="/jual/pindai" data-nav>${s.retake}</a>
          <a class="scan-link-button" href="/beli" data-nav>${s.catalog}</a>
        </div>
      </aside>
    </div>
  </section>`}function M(e){let t=[[`Sumber`,e.mock?`Mode simulasi · dibuat lokal, bukan dari KIRI`:`KIRI Engine · 3DGS video, masking otomatis`],[`Berkas video`,[e.source?.filename,m(e.source?.bytes)].filter(Boolean).join(` · `)]];return e.kiri?.serial&&t.push([`Serial KIRI`,`${e.kiri.serial.slice(0,12)}${e.kiri.serial.length>12?`…`:``}`]),e.artifact&&(t.push([`Jumlah splat`,Number(e.artifact.splatCount).toLocaleString(`id-ID`)]),t.push([`Ukuran SPZ`,m(e.artifact.bytes)])),e.timings?.totalMs&&t.push([`Waktu total`,h(Math.round(e.timings.totalMs/1e3))]),t.push([`Selesai`,g(e.completedAt)]),t}export{p as S,E as _,l as a,D as b,o as c,h as d,T as f,x as g,_ as h,A as i,b as l,v as m,M as n,s as o,w as p,j as r,r as s,O as t,m as u,y as v,f as x,S as y};
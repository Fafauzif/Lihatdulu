import{t as e}from"./index-DnUerqMP.js";var t=class extends Error{constructor(e,t,n=0,r=!1){super(t||`Terjadi kesalahan.`),this.name=`ScanApiError`,this.code=e,this.status=n,this.retryable=r}},n=Object.freeze([`uploading`,`submitting`,`queued`,`processing`,`downloading`,`converting`,`ready`]),r=Object.freeze({uploading:`Mengunggah video`,submitting:`Mengirim ke KIRI Engine`,queued:`Menunggu antrean KIRI`,processing:`KIRI memproses video`,downloading:`Mengunduh hasil`,converting:`Menyiapkan pratinjau 3D`,ready:`Selesai`,failed:`Berhenti`,expired:`Kedaluwarsa`}),i=Object.freeze([`ready`,`failed`,`expired`]),a=Object.freeze({video_too_large:`Video melebihi 200 MB. Pilih rekaman yang lebih pendek.`,video_too_long:`Video lebih dari 3 menit. Potong dulu menjadi satu putaran barang.`,video_too_large_dimensions:`Resolusi video di atas 1920×1080. KIRI hanya menerima sampai Full HD.`,video_not_mp4:`Berkas ini bukan MP4. Pilih video MP4 dari galeri.`,video_too_long:`Video lebih dari 3 menit. Rekam satu putaran barang saja, lalu coba lagi.`,video_needs_converter:`Rekaman ini berformat WebM dan server belum bisa mengonversinya. Rekam lewat aplikasi kamera atau pilih berkas MP4.`,video_convert_failed:`Rekaman gagal dikonversi ke MP4. Coba rekam lagi, atau pilih berkas MP4 dari galeri.`,video_unreadable:`Video ini tidak bisa dibaca browser. Coba rekam ulang atau pilih berkas lain.`,upload_empty:`Berkas video kosong. Pilih video lain.`,photos_too_few:`Kirim minimal 20 foto. KIRI meminta 20 sampai 300 sudut untuk menyusun bentuk.`,photos_invalid:`Berkas ZIP hanya boleh berisi foto JPG atau PNG.`,missing_key:`Server demo belum diberi kunci KIRI. Hubungi operator.`,kiri_unauthorized:`Kunci KIRI ditolak. Operator perlu memeriksa KIRI_API_KEY.`,kiri_no_credit:`Kredit KIRI Engine habis. Operator perlu menambah kredit.`,kiri_rate_limited:`KIRI Engine sedang membatasi permintaan. Coba lagi sebentar.`,kiri_unavailable:`KIRI Engine tidak bisa dihubungi sekarang. Coba lagi.`,kiri_network:`Sambungan ke server terputus. Periksa jaringan lalu coba lagi.`,kiri_failed:`KIRI Engine gagal menyusun model dari video ini. Rekam ulang dengan lebih banyak sudut.`,kiri_expired:`Hasil ini sudah kedaluwarsa di KIRI Engine. Kirim video lagi.`,zip_invalid:`Berkas hasil dari KIRI tidak bisa dibaca. Coba proses ulang.`,ply_invalid:`Hasil KIRI bukan berkas splat 3D yang dikenali. Rekam ulang barangnya.`,ply_empty:`Hasil KIRI tidak berisi titik splat. Rekam ulang barangnya.`,model_invalid:`Hasil KIRI bukan berkas model 3D (GLB) yang dikenali. Rekam ulang barangnya.`,convert_failed:`Konversi ke SPZ gagal di server. Coba proses ulang.`,spz_invalid:`Berkas SPZ hasil konversi rusak. Coba proses ulang.`,artifact_too_large:`Hasil 3D terlalu besar untuk dibuka di ponsel.`,submit_interrupted:`Server sempat berhenti saat mengirim video. Kirim ulang video ini.`,not_found:`Pekerjaan pindai tidak ditemukan.`,conflict:`Pekerjaan ini belum bisa dicoba ulang.`,network:`Sambungan terputus. Periksa jaringan lalu coba lagi.`,aborted:`Pengiriman dibatalkan.`,internal:`Terjadi kesalahan. Coba lagi.`,default:`Terjadi kesalahan. Coba lagi.`}),o=Object.freeze({title:`Ubah video barangmu menjadi model 3D.`,lede:`Rekam satu putaran pelan, atau pilih video yang sudah ada. Video dikirim ke KIRI Engine untuk diproses di cloud, lalu hasilnya bisa diputar di halaman ini.`,consent:`Saya setuju video ini dikirim ke KIRI Engine untuk diproses di cloud.`,submit:`Kirim ke KIRI Engine`,submitting:`Mengirim…`,pick:`Pilih video`,change:`Ganti video`,openResult:`Buka hasil 3D`,another:`Pindai barang lain`,resend:`Kirim ulang video ini`,retry:`Coba proses ulang`,cloudNote:`Video diproses di server KIRI Engine, bukan di laptop ini. Satu kiriman memakai kredit KIRI milik operator.`,privacyNote:`Server hanya menyimpan berkas video sementara untuk dikirim, lalu menghapusnya. Simpan hasil 3D di server ini, bukan di KIRI.`,mockNote:`Mode simulasi aktif: KIRI tidak dihubungi, tidak ada kredit terpakai, dan model di halaman hasil dibuat secara lokal untuk menguji alur.`,unconfiguredNote:`Server belum diberi kunci KIRI, jadi pengiriman dinonaktifkan. Alur dan tampilan masih bisa diperiksa.`}),s=Object.freeze({badge:`Hasil pindai`,notFound:`Hasil pindai tidak ditemukan.`,notFoundNote:`Periksa tautannya, atau pindai barang baru dari halaman penjual.`,retake:`Pindai barang lain`,catalog:`Lihat katalog`,retry:`Coba proses ulang`,modelNote:`Model 3D ini berasal dari video yang diproses KIRI Engine, bukan contoh Sora.`,demoNote:`Contoh tersimpan: satu pindaian kursi asli yang sudah diproses KIRI Engine. Tidak ada kredit terpakai untuk membukanya.`,hint:`Tarik untuk memutar · cubit untuk memperbesar`,tabRefined:`Hasil halus`,tabRaw:`Pindaian asli`,tabSplat:`Pindaian asli`,tabPhotos:`Foto asli`,inferred:`Pratinjau 3D perkiraan. Cek foto asli untuk kondisi barang.`,photosHeading:`Foto asli dari penjual`,photosNote:`Foto ini yang dilihat KIRI. Bandingkan dengan model: warna, tekstur, dan lubang asli paling jelas di sini.`,photosCaveat:`Tampilan foto, bukan model 3D.`,openModel:`Buka model 3D`,refine:`Coba haluskan lagi`,caveat:`Hasil cloud bergantung pada rekaman: bahan tembus cahaya dapat berlubang, dan bagian yang mengkilap atau tidak pernah terlihat kamera dapat kehilangan bentuk.`}),c=`lihatdulu:kiri-job`,l=Object.freeze({maxUploadBytes:209715200,maxDurationS:180,maxWidth:1920,maxHeight:1080}),u=/\.(mp4|webm|mov)$/i,d=new Set([`video/mp4`,`video/webm`,`video/quicktime`,`video/x-m4v`]);function f(e){return{ok:!1,code:e,message:a[e]??a.default}}function p({name:e=``,type:t=``,size:n=0}={},r=l){return u.test(e)||d.has(t)?n?n>r.maxUploadBytes?f(`video_too_large`):{ok:!0,code:null,message:``}:f(`upload_empty`):f(`video_not_mp4`)}function m(e={},t=l){let n=p(e,t);if(!n.ok)return n;let{durationS:r=0,width:i=0,height:a=0}=e,o=r===null;if(!o&&(!Number.isFinite(r)||r<=0))return f(`video_unreadable`);if(!o&&r>t.maxDurationS+1)return f(`video_too_long`);let s=Math.max(i,a),c=Math.min(i,a);return s>Math.max(t.maxWidth,t.maxHeight)||c>Math.min(t.maxWidth,t.maxHeight)?f(`video_too_large_dimensions`):{ok:!0,code:null,message:``}}function h(e){let t=Number(e)||0;if(t<=0)return`0 MB`;if(t<1048576)return`${Math.max(1,Math.round(t/1024))} KB`;let n=t/1048576;return`${n.toFixed(n>=10?0:1).replace(`.`,`,`)} MB`}function g(e){let t=Number(e);if(!Number.isFinite(t)||t<=0)return`—`;let n=Math.max(0,Math.round(t)),r=Math.floor(n/60),i=n%60;return r?`${r} mnt ${String(i).padStart(2,`0`)} dtk`:`${i} dtk`}function _(e){if(!e)return`—`;let t=new Date(e);return Number.isNaN(t.getTime())?`—`:new Intl.DateTimeFormat(`id-ID`,{dateStyle:`medium`,timeStyle:`short`}).format(t)}function v(e){let t=[1500,2e3,3e3,5e3,8e3];return t[Math.min(t.length-1,Math.max(0,Number(e)||0))]}function y(e){return i.includes(e)}function b(e){let t=n.indexOf(e);return t===-1?0:t}function x(e,t){return a[e]??t??a.default}function S(e){try{let t=e?.getItem(c);return typeof t==`string`&&/^[0-9a-f-]{36}$/.test(t)?t:null}catch{return null}}function C(e,t){try{t?e?.setItem(c,t):e?.removeItem(c)}catch{}}async function w(e){let n=null;try{n=await e.json()}catch{n=null}let r=n?.error;return new t(r?.code??`internal`,r?.message,e.status,r?.retryable===!0)}async function T({signal:e}={}){let n;try{n=await fetch(`/api/kiri/config`,{signal:e,headers:{accept:`application/json`}})}catch{throw new t(`network`,a.network)}if(!n.ok)throw await w(n);return n.json()}async function E(e,{signal:n}={}){let r;try{r=await fetch(`/api/kiri/jobs/${encodeURIComponent(e)}`,{signal:n,headers:{accept:`application/json`}})}catch(e){throw e?.name===`AbortError`?e:new t(`network`,a.network)}if(!r.ok)throw await w(r);return r.json()}async function D(e){let n;try{n=await fetch(`/api/kiri/jobs/${encodeURIComponent(e)}/refine`,{method:`POST`,headers:{accept:`application/json`}})}catch{throw new t(`network`,a.network)}if(!n.ok)throw await w(n);return n.json()}async function O(e){let n;try{n=await fetch(`/api/kiri/jobs/${encodeURIComponent(e)}/retry`,{method:`POST`,headers:{accept:`application/json`}})}catch{throw new t(`network`,a.network)}if(!n.ok)throw await w(n);return n.json()}function k(e,{onProgress:n=()=>{},signal:r}={}){return new Promise((i,o)=>{let s=new XMLHttpRequest;s.open(`POST`,`/api/kiri/jobs`),s.responseType=`json`,s.setRequestHeader(`content-type`,e.type||`video/mp4`),s.setRequestHeader(`x-file-name`,encodeURIComponent(e.name||`video.mp4`)),s.upload.addEventListener(`progress`,e=>{e.lengthComputable&&e.total>0&&n(Math.min(.99,e.loaded/e.total))}),s.addEventListener(`load`,()=>{let e=s.response??(()=>{try{return JSON.parse(s.responseText)}catch{return null}})();if(s.status>=200&&s.status<300){n(1),i(e);return}let r=e?.error;o(new t(r?.code??`internal`,r?.message,s.status,r?.retryable===!0))}),s.addEventListener(`error`,()=>o(new t(`network`,a.network))),s.addEventListener(`abort`,()=>o(new t(`aborted`,a.aborted))),r?.addEventListener(`abort`,()=>s.abort(),{once:!0}),s.send(e)})}var A=Object.freeze([`Mulai dari depan. Seluruh barang di dalam bingkai.`,`Geser pelan ke kanan, jangan potong kakinya.`,`Terus ke belakang, tunjukkan panel belakang.`,`Dekati bagian dalam atau laci yang terbuka.`,`Tunjukkan bekas pemakaian dari dekat.`,`Kembali ke depan untuk menutup putaran.`]);Object.freeze([`Nyalakan lampu ruangan. Hindari jendela terang tepat di belakang barang.`,`Jalan satu putaran pelan dengan jarak tetap, barang utuh dari bawah sampai atas.`,`Barang matte dan padat paling aman. Jaring tipis, kaca, atau bahan tembus cahaya sering berlubang pada hasil.`,`Tunjukkan bagian tersembunyi seperti kaki dan kolom di bawah dudukan.`]);var j=Object.freeze([`video/mp4;codecs=avc1.42E01E`,`video/mp4`,`video/webm;codecs=vp9`,`video/webm;codecs=vp8`,`video/webm`]);function M(e){if(typeof e!=`function`)return null;for(let t of j)try{if(e(t))return t}catch{}return null}function N(e){return/mp4/i.test(String(e??``))?`mp4`:`webm`}function P(e,t=Date.now()){return`rekaman-${t}.${N(e)}`}function F(e){let t=Number.isFinite(e)?Math.floor(Math.max(0,e)/7):0;return A[Math.min(A.length-1,t)]}function I(e){let t=Math.max(0,Math.floor(Number(e)||0));return`${Math.floor(t/60)}:${String(t%60).padStart(2,`0`)}`}function L(e){if(e?.insecure)return`Kamera hanya bisa dibuka lewat sambungan aman (HTTPS). Rekam lewat aplikasi kamera, atau buka tautan ini dari alamat https.`;switch(e?.name){case`NotAllowedError`:case`SecurityError`:return`Izin kamera ditolak. Izinkan kamera di pengaturan browser, lalu tekan Nyalakan kamera lagi — atau rekam lewat aplikasi kamera.`;case`NotFoundError`:case`OverconstrainedError`:return`Kamera tidak ditemukan di perangkat ini. Rekam lewat aplikasi kamera, lalu pilih berkasnya di sini.`;case`NotReadableError`:case`AbortError`:return`Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi — atau rekam lewat aplikasi kamera.`;default:return`Kamera belum bisa dinyalakan. Coba muat ulang halaman, atau rekam lewat aplikasi kamera.`}}function R(e){return e?.unsupported?`Browser ini belum bisa merekam video di halaman. Rekam lewat aplikasi kamera, lalu pilih berkasnya di sini.`:e?.empty?`Rekaman kosong. Coba rekam lagi.`:e?.short?`Rekaman terlalu pendek. Rekam minimal 8 detik supaya KIRI punya cukup sudut.`:`Perekaman berhenti sebelum selesai. Coba rekam lagi.`}var z=Object.freeze({uploading:`Mengunggah video…`,submitting:`Mengirim ke KIRI Engine…`,queued:`Menunggu antrean KIRI…`,processing:`KIRI memproses video…`,downloading:`Mengunduh hasil…`,converting:`Menyiapkan pratinjau 3D…`,ready:`Model 3D siap`,failed:`Pemrosesan berhenti`,expired:`Hasil kedaluwarsa`}),B=Object.freeze([`Pilih barang matte dan padat. Jaring tipis, kaca, atau bahan tembus cahaya sering berlubang pada hasil.`,`Nyalakan lampu ruangan dan hindari jendela tepat di belakang barang. Bagian yang selalu gelap tidak terbentuk.`,`Berjalan satu putaran pelan dengan jarak tetap, barang utuh di dalam bingkai dari bawah sampai atas.`,`Rekam juga bagian yang tersembunyi, misalnya kaki dan kolom di bawah dudukan, karena kamera tidak bisa menebaknya.`]);function V(){return n.map(e=>`<li data-scan-stage="${e}"><span aria-hidden="true"></span>${r[e]}</li>`).join(``)}function H(){let t=h(l.maxUploadBytes);return`
  <section class="scan-upload" data-scan-upload>
    <header class="scan-upload-head">
      <p class="scan-eyebrow">Pindai furnitur · KIRI Engine</p>
      <h1>Pindai furniturmu.</h1>
      <p class="scan-lede">Rekam satu putaran pelan, atau pilih video yang sudah ada. Video dikirim ke KIRI Engine dan kembali sebagai model 3D yang bisa diputar pembeli.</p>
      <p class="scan-mode" data-scan-mode hidden></p>
      <p class="scan-example-link">${e(`cube`)}<a href="/pindai/demo-chair" data-nav>Lihat contoh hasil dari kursi asli</a><span>· tanpa kredit, tanpa unggah</span></p>
    </header>

    <div class="scan-upload-grid">
      <section class="scan-panel" data-scan-picker>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">1</span>
          <h2>Ambil video</h2>
        </div>
        <p class="scan-panel-note">Satu video untuk satu barang. Rekam 15–45 detik sambil berjalan mengelilingi barang.</p>

        <div class="scan-source-actions">
          <button type="button" class="scan-source primary" data-scan-open-camera>${e(`camera`)} Rekam dengan kamera</button>
          <button type="button" class="scan-source" data-scan-choose>${e(`film`)} ${o.pick}</button>
        </div>
        <p class="scan-source-note">Di ponsel, tombol rekam langsung memakai kamera belakang. Tidak ada yang diunggah sampai kamu menyetujui di langkah 2.</p>

        <div class="scan-recorder" data-scan-recorder hidden data-stage="idle">
          <div class="scan-recorder-stage">
            <video class="scan-recorder-video" data-rec-video playsinline muted autoplay></video>
            <video class="scan-recorder-video" data-rec-review playsinline controls hidden></video>
            <p class="scan-recorder-empty" data-rec-empty>Kamera belum menyala.</p>
            <div class="scan-recorder-hud">
              <span class="scan-recorder-timer" data-rec-timer>0:00</span>
              <span class="scan-recorder-dot" data-rec-dot hidden><i aria-hidden="true"></i>Merekam</span>
            </div>
            <p class="scan-recorder-guide" data-rec-guide aria-live="polite">${A[0]}</p>
          </div>
          <div class="scan-recorder-actions">
            <button type="button" class="scan-link-button primary" data-rec-start hidden>Mulai merekam</button>
            <button type="button" class="scan-link-button" data-rec-stop hidden>Hentikan</button>
            <button type="button" class="scan-link-button primary" data-rec-use hidden>Gunakan rekaman</button>
            <button type="button" class="scan-link-button" data-rec-retake hidden>Rekam ulang</button>
            <button type="button" class="scan-link-button" data-rec-native>Rekam lewat aplikasi kamera</button>
            <button type="button" class="scan-link-button" data-rec-close>Batal</button>
          </div>
          <input type="file" accept="video/*" capture="environment" data-rec-native-input hidden>
          <p class="scan-recorder-status" data-rec-status role="status" aria-live="polite"></p>
        </div>

        <input class="scan-file-input" data-scan-input type="file" accept="video/mp4,video/webm,video/quicktime" hidden>
        <div class="scan-drop" data-scan-drop>
          <p>atau seret berkas video ke sini · MP4, WebM, atau MOV sampai ${t}</p>
        </div>
        <figure class="scan-media" data-scan-media hidden>
          <video data-scan-video controls playsinline muted preload="metadata"></video>
          <figcaption data-scan-facts></figcaption>
        </figure>
        <p class="scan-field-error" data-scan-file-error role="alert" hidden></p>
        <button type="button" class="scan-link-button" data-scan-change hidden>${o.change}</button>

        <details class="scan-tips-block">
          <summary>Supaya hasilnya bersih</summary>
          <ul class="scan-tips" data-scan-tips>${B.map(e=>`<li>${e}</li>`).join(``)}</ul>
        </details>
      </section>

      <section class="scan-panel" data-scan-confirm>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">2</span>
          <h2>Setujui pengiriman</h2>
        </div>
        <ul class="scan-facts">
          <li><strong>Diproses di cloud.</strong> ${o.cloudNote}</li>
          <li><strong>Butuh kredit.</strong> Setiap kiriman memakai kredit KIRI milik operator demo.</li>
          <li><strong>Batas KIRI.</strong> Video sampai ${t}, ${l.maxDurationS/60} menit, maksimal 1920×1080.</li>
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
      <ol class="scan-stages" data-scan-stages>${V()}</ol>
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
      <div class="scan-wait-links" data-scan-wait hidden>
        <p>Sambil menunggu, kamu bisa membuka hasil yang sudah tersimpan:</p>
        <a href="/pindai/demo-chair" data-nav>${e(`cube`)} Contoh hasil pindai · kursi asli</a>
        <a href="/barang/sora?tab=model" data-nav>${e(`cube`)} Lemari Sora dalam 3D</a>
      </div>
    </section>
  </section>`}function U(){return`
  <section class="scan-preview" data-scan-preview>
    <header class="scan-preview-head">
      <p class="scan-preview-badge">${s.badge}</p>
      <h1 data-scan-title>Hasil pindai</h1>
      <p class="scan-preview-facts" data-scan-facts>Menyiapkan model 3D…</p>
      <p class="scan-preview-disclaimer" data-scan-provider></p>
      <p class="scan-open-reason" data-scan-open-reason hidden></p>
    </header>
    <div class="scan-preview-grid">
      <div class="scan-preview-main">
        <div class="scan-source-tabs" data-scan-tabs role="tablist" aria-label="Sumber pratinjau" hidden></div>
        <div class="scan-viewer" data-scan-viewer data-state="idle">
          <p class="scan-viewer-placeholder" data-scan-viewer-placeholder>Menunggu model siap…</p>
        </div>
        <p class="scan-viewer-hint-line" data-scan-hint>${s.hint}</p>
        <p class="scan-viewer-caveat" data-scan-caveat>${s.caveat}</p>
        <p class="scan-refine-note" data-scan-refine-note hidden></p>
        <section class="scan-photos" data-scan-photos hidden>
          <div class="scan-photos-head">
            <div>
              <h2>${s.photosHeading}</h2>
              <p class="scan-photos-note">${s.photosNote}</p>
            </div>
            <button type="button" class="scan-link-button primary" data-scan-open-model hidden>${s.openModel}</button>
          </div>
          <ul class="scan-photo-grid" data-scan-photo-grid></ul>
        </section>
      </div>
      <aside class="scan-preview-side">
        <section class="scan-card" data-scan-status>
          <h2>Proses</h2>
          <ol class="scan-stages" data-scan-stages>${V()}</ol>
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
          <button type="button" class="scan-link-button" data-scan-refine hidden>${s.refine}</button>
          <a class="scan-link-button primary" href="/jual/pindai" data-nav>${s.retake}</a>
          <a class="scan-link-button" href="/beli" data-nav>${s.catalog}</a>
        </div>
      </aside>
    </div>
  </section>`}function W(e){let t=K(e).map(e=>e.id);return e?.photos?.length&&G(e)&&t.includes(`photos`)?`photos`:t.includes(`refined`)?`refined`:t.includes(`raw`)?`raw`:t[0]??null}function G(e){let t=e?.refine?.coverage??e?.refine?.metrics?.coverage,n=Number(t?.holeRatioAfter);return t?.verdict===`berlubang`&&Number.isFinite(n)&&n>=.1}function K(e){if(!e||e.stage!==`ready`)return[];let t=[],n=e.artifact?.format===`glb`;n&&e.artifact?.refined&&t.push({id:`refined`,label:s.tabRefined,url:e.artifact.url,format:`glb`,caveat:s.inferred}),n?t.push({id:`raw`,label:s.tabRaw,url:e.artifact?.raw?.url??e.artifact.url,format:`glb`,caveat:s.caveat}):e.artifact?.url&&t.push({id:`raw`,label:s.tabSplat,url:e.artifact.url,format:`spz`,caveat:s.caveat}),(e.photos??[]).length&&t.push({id:`photos`,label:s.tabPhotos,url:null,format:null,caveat:s.photosCaveat});let r=G(e)&&e.photos?.length?`photos`:null;return r&&t.sort((e,t)=>e.id===r?-1:+(t.id===r)),t}function q(e){let t=Number(e);return!Number.isFinite(t)||t<=0?``:`${(t*100).toLocaleString(`id-ID`,{maximumFractionDigits:1})}%`}function J(e){let t=e?.refine;if(!t)return``;if(t.status===`applied`){let e=t.metrics??{},n=[];e.fragmentsRemoved&&n.push(`${e.fragmentsRemoved} pecahan dibuang`),e.gapsFilled&&n.push(`${e.gapsFilled} celah kecil ditutup`),n.length||n.push(`geometri dirapikan`);let r=Number(e.trianglesBefore??0),i=Number(e.trianglesAfter??0),a=r&&i?` · ${r.toLocaleString(`id-ID`)} → ${i.toLocaleString(`id-ID`)} segitiga`:``,o=q(e.coverage?.holeRatioAfter),s=e.coverage?.verdict===`berlubang`&&o?` Masih ${o} siluet yang tembus pandang; bagian itu tidak ditambal karena seringkali memang bolong pada barangnya.`:``;return`Penyempurnaan lokal: ${n.join(`, `)}${a}.${s}`}return t.status===`failed`?`Penyempurnaan lokal gagal. Pindaian asli tetap tersedia, dan tahap ini bisa dicoba lagi tanpa memakai kredit.`:t.status===`skipped`?`Penyempurnaan lokal dilewati: bentuk mesh ini belum bisa dirapikan dengan aman. Pindaian asli ditampilkan apa adanya.`:t.status===`disabled`?`Penyempurnaan lokal dimatikan di server ini. Pindaian asli ditampilkan apa adanya.`:``}function Y(e){if(!e)return[];let t=e.unit===`cm`?`cm`:e.unit??``;return[[`Ukuran dari penjual`,`${e.length} × ${e.width} × ${e.height} ${t}`.trim()]]}var X={0:`High`,1:`Medium`,2:`Low`,3:`Ultra`};function Z(e){let t=X[e.input?.modelQuality]??X[0],n=e.input?.source===`photos`,r=[[`Sumber`,e.mock?`Mode simulasi · dibuat lokal, bukan dari KIRI`:n?`KIRI Engine · Photo Scan ${t}, masking otomatis, ${e.input?.photos??0} foto pilihan penjual`:e.input?.mode===`mesh`?`KIRI Engine · mesh objek (featureless), ${e.input.photos} foto dari video`:e.input?.mode===`photo`?`KIRI Engine · Photo Scan ${t}, masking otomatis, ${e.input.photos} foto dari video`:e.input?.mode===`splat`?`KIRI Engine · 3DGS foto, ${e.input.photos} still dari video`:e.input?.fallback?`KIRI Engine · 3DGS video, masking otomatis · mundur ke unggah video`:`KIRI Engine · 3DGS video, masking otomatis`],[n?`Berkas foto`:`Berkas video`,[e.source?.filename,h(e.source?.bytes)].filter(Boolean).join(` · `)],...e.source?.transcodedFrom?[[`Format rekaman`,`${String(e.source.transcodedFrom).toUpperCase()} dari ponsel, dikonversi ke MP4 di server`]]:[],...Y(e.source?.dimensions)];if(e.kiri?.serial&&r.push([`Serial KIRI`,`${e.kiri.serial.slice(0,12)}${e.kiri.serial.length>12?`…`:``}`]),e.artifact&&(e.artifact.format===`glb`?(r.push([`Jumlah segitiga`,Number(e.artifact.triangles??0).toLocaleString(`id-ID`)]),r.push([`Ukuran GLB`,h(e.artifact.bytes)])):(r.push([`Jumlah splat`,Number(e.artifact.splatCount).toLocaleString(`id-ID`)]),r.push([`Ukuran SPZ`,h(e.artifact.bytes)]))),e.refine?.status===`applied`&&e.refine.metrics){let t=e.refine.metrics;r.push([`Penyempurnaan`,[t.trianglesBefore&&t.trianglesAfter?`${Number(t.trianglesBefore).toLocaleString(`id-ID`)} → ${Number(t.trianglesAfter).toLocaleString(`id-ID`)} segitiga`:null,t.fragmentsRemoved?`${t.fragmentsRemoved} pecahan dibuang`:null,t.gapsFilled?`${t.gapsFilled} celah ditutup`:null].filter(Boolean).join(` · `)||`diterapkan`])}return(e.photos??[]).length&&r.push([`Foto asli`,`${e.photos.length} foto disimpan`]),e.timings?.totalMs&&r.push([`Waktu total`,g(Math.round(e.timings.totalMs/1e3))]),r.push([`Selesai`,_(e.completedAt)]),r}export{O as A,g as C,v as D,y as E,m as F,C as M,k as N,S as O,p as P,h as S,T,l as _,W as a,o as b,H as c,L as d,P as f,I as g,R as h,q as i,b as j,D as k,K as l,M as m,Z as n,J as o,F as p,G as r,U as s,z as t,A as u,s as v,E as w,x,r as y};
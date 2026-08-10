/* ============================================================
   Grave e Leia — lógica principal (100% client-side, sem APIs)
   ============================================================ */

/* ---------------- Service worker / instalação ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

document.getElementById('btnInstall').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  } else {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      alert('Para instalar no iPhone: toque no ícone de compartilhar do Safari e escolha "Adicionar à Tela de Início".');
    } else {
      alert('Para instalar: abra o menu do navegador e escolha "Instalar aplicativo" ou "Adicionar à tela inicial".');
    }
  }
});

/* ---------------- Roteamento simples entre telas ---------------- */
const screens = {
  home: document.getElementById('screen-home'),
  vertical: document.getElementById('screen-vertical'),
  horizontal: document.getElementById('screen-horizontal'),
  apresentacao: document.getElementById('screen-apresentacao'),
  edicao: document.getElementById('screen-edicao'),
  meio: document.getElementById('screen-meio'),
  videos: document.getElementById('screen-videos'),
};

let currentScreen = 'home';
const onEnter = {};
const onLeave = {};

function goTo(name) {
  if (onLeave[currentScreen]) onLeave[currentScreen]();
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
  currentScreen = name;
  if (onEnter[name]) onEnter[name]();
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.go));
});
document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => goTo('home'));
});

/* ---------------- IndexedDB: armazenamento dos vídeos ---------------- */
const DB_NAME = 'graveELeiaDB';
const STORE = 'videos';
let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function saveVideo({ name, blob, source }) {
  const db = await dbPromise;
  const record = { id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name, blob, source, date: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

async function listVideos() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.date - a.date));
    req.onerror = () => reject(req.error);
  });
}

async function deleteVideo(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getVideo(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- Utilitários gerais ---------------- */
function pickMimeType() {
  const options = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of options) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function extFromMime(mime) {
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

/* Sessão de gravação baseada em canvas: permite compor câmera + texto/zoom/PIP
   em qualquer combinação e gerar um único arquivo de vídeo ao final. */
class CanvasRecorder {
  constructor(canvas, drawFrame, fps = 30) {
    this.canvas = canvas;
    this.drawFrame = drawFrame;
    this.fps = fps;
    this.stream = canvas.captureStream(fps);
    this.mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = null;
    this._raf = null;
    this._running = false;
  }
  _loop() {
    if (!this._running) return;
    this.drawFrame();
    this._raf = requestAnimationFrame(() => this._loop());
  }
  start() {
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.start(250);
    this._running = true;
    this._loop();
  }
  pause() { if (this.recorder && this.recorder.state === 'recording') this.recorder.pause(); }
  resume() { if (this.recorder && this.recorder.state === 'paused') this.recorder.resume(); }
  stop() {
    return new Promise((resolve) => {
      this._running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: this.mimeType || 'video/webm' }));
        return;
      }
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType || 'video/webm' }));
      this.recorder.stop();
    });
  }
}

/* Desenha um <video> dentro de um retângulo do canvas em modo "cover", com zoom opcional */
function drawCover(ctx, video, x, y, w, h, zoom = 1) {
  if (!video || video.videoWidth === 0) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const vRatio = vw / vh, rRatio = w / h;
  let sw, sh, sx, sy;
  if (vRatio > rRatio) {
    sh = vh; sw = vh * rRatio; sy = 0; sx = (vw - sw) / 2;
  } else {
    sw = vw; sh = vw / rRatio; sx = 0; sy = (vh - sh) / 2;
  }
  // aplica zoom recortando ainda mais no centro
  const zsw = sw / zoom, zsh = sh / zoom;
  sx = sx + (sw - zsw) / 2;
  sy = sy + (sh - zsh) / 2;
  ctx.drawImage(video, sx, sy, zsw, zsh, x, y, w, h);
}

/* ---------------- Câmera: abrir stream com fallback ---------------- */
async function openCamera(videoEl, facingMode = 'user') {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: true,
    });
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});
    return stream;
  } catch (err) {
    alert('Não foi possível acessar a câmera/microfone. Verifique as permissões do navegador.');
    throw err;
  }
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

function getZoomCapableTrack(stream) {
  if (!stream) return null;
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  return caps && caps.zoom ? track : null;
}

/* ============================================================
   TELEPROMPTER (compartilhado entre vertical e horizontal)
   ============================================================ */
function setupTeleprompter(prefix) {
  const wrap = document.getElementById(prefix + '-textWrap');
  const textEl = document.getElementById(prefix + '-text');
  const playBtn = document.getElementById(prefix + '-playText');
  const speed = document.getElementById(prefix + '-speed');
  const editBtn = document.getElementById(prefix + '-editText');

  let pos = 0;
  let playing = false;
  let raf = null;

  function tick() {
    if (!playing) return;
    pos -= Number(speed.value) / 60; // px por frame aproximado
    const maxScroll = -(textEl.scrollHeight);
    if (pos < maxScroll) pos = wrap.clientHeight; // recomeça suavemente
    textEl.style.transform = 'translateY(' + pos + 'px)';
    raf = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸' : '▶';
    if (playing) tick();
    else if (raf) cancelAnimationFrame(raf);
  });

  editBtn.addEventListener('click', () => openTextModal(textEl.textContent, (val) => {
    textEl.textContent = val || '';
    pos = wrap.clientHeight;
    textEl.style.transform = 'translateY(' + pos + 'px)';
  }));

  return {
    reset() {
      playing = false;
      playBtn.textContent = '▶';
      if (raf) cancelAnimationFrame(raf);
      pos = wrap.clientHeight;
      textEl.style.transform = 'translateY(' + pos + 'px)';
    },
  };
}

/* Modal simples para editar o texto do teleprompter */
const textModal = document.getElementById('textModal');
const textModalArea = document.getElementById('textModalArea');
let textModalCallback = null;
document.getElementById('textModalSave').addEventListener('click', () => {
  textModal.classList.add('hidden');
  if (textModalCallback) textModalCallback(textModalArea.value);
});
document.getElementById('textModalCancel').addEventListener('click', () => {
  textModal.classList.add('hidden');
});
function openTextModal(current, cb) {
  textModalArea.value = current || '';
  textModalCallback = cb;
  textModal.classList.remove('hidden');
}

/* ============================================================
   Fluxo genérico de gravação por toque (usado nas 4 telas de câmera)
   ============================================================ */
/*
  states: idle -> recording -> paused -> (recording | finished)
  onTap: idle->start ; recording->pause ; paused-> mostra opções (feito via overlay)
*/
function setupTapRecorder({ area, recIndEl, hintEl, makeRecorder, filenamePrefix, onSaved }) {
  let state = 'idle'; // idle | recording | paused
  let recorder = null;

  function showToast(html, buttons) {
    const toast = document.createElement('div');
    toast.className = 'download-toast';
    toast.innerHTML = html;
    area.appendChild(toast);
    buttons.forEach(([sel, fn]) => {
      toast.querySelector(sel).addEventListener('click', (e) => { e.stopPropagation(); fn(toast); });
    });
    return toast;
  }

  async function finishAndOffer() {
    hintEl.classList.add('hidden');
    recIndEl.classList.add('hidden');
    const blob = await recorder.stop();
    state = 'idle';
    const ext = extFromMime(recorder.mimeType || 'video/webm');
    const filename = filenamePrefix + '_' + Date.now() + '.' + ext;
    showToast(
      `<p style="font-size:16px;">Gravação finalizada!</p>
       <div class="btn-row">
         <button class="btn-white btn-ok" data-act="save">💾 Salvar e baixar</button>
         <button class="btn-white btn-danger" data-act="discard">🗑 Descartar</button>
       </div>`,
      [
        ['[data-act="save"]', async (toast) => {
          downloadBlob(blob, filename);
          await saveVideo({ name: filename, blob, source: filenamePrefix });
          toast.remove();
          if (onSaved) onSaved();
        }],
        ['[data-act="discard"]', (toast) => toast.remove()],
      ]
    );
  }

  area.addEventListener('click', async () => {
    if (state === 'idle') {
      recorder = makeRecorder();
      recorder.start();
      state = 'recording';
      recIndEl.classList.remove('hidden');
      hintEl.textContent = 'Gravando... toque para pausar';
    } else if (state === 'recording') {
      recorder.pause();
      state = 'paused';
      recIndEl.classList.add('hidden');
      const toast = showToast(
        `<p style="font-size:16px;">Gravação pausada</p>
         <div class="btn-row">
           <button class="btn-white btn-ok" data-act="continue">▶ Continuar</button>
           <button class="btn-white" data-act="finish">⏹ Finalizar e baixar</button>
           <button class="btn-white btn-danger" data-act="discard">🗑 Descartar</button>
         </div>`,
        [
          ['[data-act="continue"]', (t) => {
            recorder.resume();
            state = 'recording';
            recIndEl.classList.remove('hidden');
            hintEl.textContent = 'Gravando... toque para pausar';
            t.remove();
          }],
          ['[data-act="finish"]', async (t) => { t.remove(); await finishAndOffer(); }],
          ['[data-act="discard"]', async (t) => {
            await recorder.stop();
            state = 'idle';
            hintEl.textContent = 'Toque na tela para iniciar a gravação';
            hintEl.classList.remove('hidden');
            t.remove();
          }],
        ]
      );
    }
  });

  return {
    stopAndCleanup() {
      if (recorder && state !== 'idle') { try { recorder.stop(); } catch (e) {} }
      state = 'idle';
    },
  };
}

/* ============================================================
   1) GRAVAR NA VERTICAL (TikTok) — texto em cima, câmera embaixo
   ============================================================ */
(function initVertical() {
  const video = document.getElementById('v-video');
  const camArea = document.getElementById('v-camArea');
  const recInd = document.getElementById('v-recInd');
  const hint = document.getElementById('v-hint');
  const zoomSlider = document.getElementById('v-zoom');
  let stream = null;
  let zoomTrack = null;
  let zoomVal = 1;
  const tele = setupTeleprompter('v');

  const canvas = document.createElement('canvas');
  canvas.width = 720; canvas.height = 1280;
  const ctx = canvas.getContext('2d');

  function drawFrame() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCover(ctx, video, 0, 0, canvas.width, canvas.height, zoomVal);
  }

  zoomSlider.addEventListener('input', () => {
    zoomVal = Number(zoomSlider.value);
    if (zoomTrack) {
      zoomTrack.applyConstraints({ advanced: [{ zoom: zoomVal }] }).catch(() => {});
    }
  });

  const tapRecorder = setupTapRecorder({
    area: camArea,
    recIndEl: recInd,
    hintEl: hint,
    filenamePrefix: 'vertical_tiktok',
    makeRecorder: () => new CanvasRecorder(canvas, drawFrame, 30),
    onSaved: () => {},
  });

  onEnter.vertical = async () => {
    tele.reset();
    zoomSlider.value = 1; zoomVal = 1;
    stream = await openCamera(video, 'user');
    zoomTrack = getZoomCapableTrack(stream);
    hint.classList.remove('hidden');
    hint.textContent = 'Toque na tela para iniciar a gravação';
  };
  onLeave.vertical = () => {
    tapRecorder.stopAndCleanup();
    stopStream(stream);
    stream = null;
  };
})();

/* ============================================================
   2) GRAVAR NA HORIZONTAL (YouTube) — texto esquerda, câmera direita
   ============================================================ */
(function initHorizontal() {
  const video = document.getElementById('h-video');
  const camArea = document.getElementById('h-camArea');
  const recInd = document.getElementById('h-recInd');
  const hint = document.getElementById('h-hint');
  const zoomSlider = document.getElementById('h-zoom');
  const container = document.getElementById('h-container');
  let stream = null;
  let zoomTrack = null;
  let zoomVal = 1;
  const tele = setupTeleprompter('h');

  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');

  function drawFrame() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCover(ctx, video, 0, 0, canvas.width, canvas.height, zoomVal);
  }

  zoomSlider.addEventListener('input', () => {
    zoomVal = Number(zoomSlider.value);
    if (zoomTrack) {
      zoomTrack.applyConstraints({ advanced: [{ zoom: zoomVal }] }).catch(() => {});
    }
  });

  function applyOrientation() {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    container.style.flexDirection = isLandscape ? 'row' : 'column';
  }
  window.addEventListener('resize', applyOrientation);

  const tapRecorder = setupTapRecorder({
    area: camArea,
    recIndEl: recInd,
    hintEl: hint,
    filenamePrefix: 'horizontal_youtube',
    makeRecorder: () => new CanvasRecorder(canvas, drawFrame, 30),
    onSaved: () => {},
  });

  onEnter.horizontal = async () => {
    tele.reset();
    zoomSlider.value = 1; zoomVal = 1;
    applyOrientation();
    stream = await openCamera(video, 'user');
    zoomTrack = getZoomCapableTrack(stream);
    hint.classList.remove('hidden');
    hint.textContent = 'Toque na tela para iniciar a gravação';
  };
  onLeave.horizontal = () => {
    tapRecorder.stopAndCleanup();
    stopStream(stream);
    stream = null;
  };
})();

/* ============================================================
   3) APRESENTAÇÃO — vídeo de fundo + câmera em PIP arrastável
   ============================================================ */
(function initApresentacao() {
  const stage = document.getElementById('ap-stage');
  const bgVideo = document.getElementById('ap-bgVideo');
  const camVideo = document.getElementById('ap-camVideo');
  const pip = document.getElementById('ap-pip');
  const pipResize = document.getElementById('ap-pipResize');
  const recInd = document.getElementById('ap-recInd');
  const hint = document.getElementById('ap-hint');
  const formatSel = document.getElementById('ap-format');
  const shapeBtn = document.getElementById('ap-shape');
  const bgPickBtn = document.getElementById('ap-bgPick');
  const bgFile = document.getElementById('ap-bgFile');
  const bgPlayBtn = document.getElementById('ap-bgPlay');
  const bgRestartBtn = document.getElementById('ap-bgRestart');
  const pipSizeSlider = document.getElementById('ap-pipSize');

  let stream = null;
  let shape = 'circle';
  let bgObjectUrl = null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  function setFormat() {
    if (formatSel.value === 'tiktok') { canvas.width = 720; canvas.height = 1280; }
    else { canvas.width = 1280; canvas.height = 720; }
  }
  formatSel.addEventListener('change', setFormat);

  shapeBtn.addEventListener('click', () => {
    shape = shape === 'circle' ? 'square' : 'circle';
    pip.classList.toggle('circle', shape === 'circle');
    pip.classList.toggle('square', shape === 'square');
    shapeBtn.textContent = 'Miniatura: ' + (shape === 'circle' ? 'redonda' : 'quadrada');
  });

  bgPickBtn.addEventListener('click', () => bgFile.click());
  bgFile.addEventListener('change', () => {
    const file = bgFile.files[0];
    if (!file) return;
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl);
    bgObjectUrl = URL.createObjectURL(file);
    bgVideo.src = bgObjectUrl;
    bgVideo.play().catch(() => {});
    bgPlayBtn.textContent = '⏸';
  });
  bgPlayBtn.addEventListener('click', () => {
    if (bgVideo.paused) { bgVideo.play(); bgPlayBtn.textContent = '⏸'; }
    else { bgVideo.pause(); bgPlayBtn.textContent = '▶'; }
  });
  bgRestartBtn.addEventListener('click', () => { bgVideo.currentTime = 0; });

  // Arrastar miniatura
  let dragging = false, dragOffX = 0, dragOffY = 0;
  pip.addEventListener('pointerdown', (e) => {
    if (e.target === pipResize) return;
    dragging = true;
    const r = pip.getBoundingClientRect();
    dragOffX = e.clientX - r.left;
    dragOffY = e.clientY - r.top;
    pip.setPointerCapture(e.pointerId);
  });
  pip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const stageRect = stage.getBoundingClientRect();
    let x = e.clientX - stageRect.left - dragOffX;
    let y = e.clientY - stageRect.top - dragOffY;
    x = Math.max(0, Math.min(x, stageRect.width - pip.offsetWidth));
    y = Math.max(0, Math.min(y, stageRect.height - pip.offsetHeight));
    pip.style.left = x + 'px';
    pip.style.top = y + 'px';
  });
  pip.addEventListener('pointerup', () => { dragging = false; });

  // Redimensionar miniatura pelo cantinho
  let resizing = false;
  pipResize.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    resizing = true;
    pipResize.setPointerCapture(e.pointerId);
  });
  pipResize.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const r = pip.getBoundingClientRect();
    const size = Math.max(80, Math.min(320, e.clientX - r.left));
    pip.style.width = size + 'px';
    pip.style.height = size + 'px';
    pipSizeSlider.value = size;
  });
  pipResize.addEventListener('pointerup', () => { resizing = false; });

  pipSizeSlider.addEventListener('input', () => {
    const size = Number(pipSizeSlider.value);
    pip.style.width = size + 'px';
    pip.style.height = size + 'px';
  });

  function drawFrame() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (bgVideo.readyState >= 2 && bgVideo.videoWidth) {
      drawCover(ctx, bgVideo, 0, 0, canvas.width, canvas.height, 1);
    }
    // posição do PIP relativa ao palco -> escala para o canvas
    const stageRect = stage.getBoundingClientRect();
    const scaleX = canvas.width / stageRect.width;
    const scaleY = canvas.height / stageRect.height;
    const px = pip.offsetLeft * scaleX;
    const py = pip.offsetTop * scaleY;
    const pw = pip.offsetWidth * scaleX;
    const ph = pip.offsetHeight * scaleY;

    ctx.save();
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(px + pw / 2, py + ph / 2, Math.min(pw, ph) / 2, 0, Math.PI * 2);
    } else {
      const rad = 14 * scaleX;
      ctx.moveTo(px + rad, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, rad);
      ctx.arcTo(px + pw, py + ph, px, py + ph, rad);
      ctx.arcTo(px, py + ph, px, py, rad);
      ctx.arcTo(px, py, px + pw, py, rad);
    }
    ctx.closePath();
    ctx.clip();
    drawCover(ctx, camVideo, px, py, pw, ph, 1);
    ctx.restore();
    ctx.lineWidth = 4 * scaleX;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  }

  const tapRecorder = setupTapRecorder({
    area: stage,
    recIndEl: recInd,
    hintEl: hint,
    filenamePrefix: 'apresentacao',
    makeRecorder: () => new CanvasRecorder(canvas, drawFrame, 30),
    onSaved: () => {},
  });

  onEnter.apresentacao = async () => {
    setFormat();
    stream = await openCamera(camVideo, 'user');
    hint.classList.remove('hidden');
    hint.textContent = 'Toque na tela para iniciar a gravação';
  };
  onLeave.apresentacao = () => {
    tapRecorder.stopAndCleanup();
    stopStream(stream);
    stream = null;
    bgVideo.pause();
    if (bgObjectUrl) { URL.revokeObjectURL(bgObjectUrl); bgObjectUrl = null; }
  };
})();

/* ============================================================
   5) GRAVAR MEIO A MEIO — câmera + vídeo adicionado
   ============================================================ */
(function initMeio() {
  const container = document.getElementById('m-container');
  const camHalf = document.getElementById('m-camHalf');
  const vidHalf = document.getElementById('m-vidHalf');
  const resizer = document.getElementById('m-resizer');
  const video = document.getElementById('m-video');
  const otherVideo = document.getElementById('m-otherVideo');
  const plusBtn = document.getElementById('m-plusBtn');
  const fileInput = document.getElementById('m-fileInput');
  const recInd = document.getElementById('m-recInd');
  const hint = document.getElementById('m-hint');
  const formatSel = document.getElementById('m-format');

  let stream = null;
  let ratio = 0.5; // proporção da primeira metade (câmera)
  let otherObjectUrl = null;
  let direction = 'column';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  function setFormat() {
    if (formatSel.value === 'tiktok') { canvas.width = 720; canvas.height = 1280; direction = 'column'; }
    else { canvas.width = 1280; canvas.height = 720; direction = 'row'; }
    applyLayout();
  }

  function applyLayout() {
    container.style.display = 'flex';
    container.style.flexDirection = direction;
    camHalf.style.flexBasis = (ratio * 100) + '%';
    vidHalf.style.flexBasis = ((1 - ratio) * 100) + '%';
    resizer.className = direction === 'column' ? 'resizer-h' : 'resizer-v';
    if (direction === 'column') {
      resizer.style.top = (ratio * 100) + '%';
      resizer.style.left = '0'; resizer.style.right = '0';
    } else {
      resizer.style.left = (ratio * 100) + '%';
      resizer.style.top = '0'; resizer.style.bottom = '0';
    }
  }

  formatSel.addEventListener('change', setFormat);

  // auto-rotação: quando o formato é youtube, acompanha giro do celular
  function handleOrientation() {
    if (formatSel.value !== 'youtube') return;
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    direction = isLandscape ? 'row' : 'row'; // formato youtube já é lado a lado
    applyLayout();
  }
  window.addEventListener('resize', handleOrientation);

  // arrastar divisor
  let dragging = false;
  resizer.addEventListener('pointerdown', (e) => { dragging = true; resizer.setPointerCapture(e.pointerId); });
  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    let r;
    if (direction === 'column') r = (e.clientY - rect.top) / rect.height;
    else r = (e.clientX - rect.left) / rect.width;
    ratio = Math.max(0.2, Math.min(0.8, r));
    applyLayout();
  });
  resizer.addEventListener('pointerup', () => { dragging = false; });

  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (otherObjectUrl) URL.revokeObjectURL(otherObjectUrl);
    otherObjectUrl = URL.createObjectURL(file);
    otherVideo.src = otherObjectUrl;
    otherVideo.play().catch(() => {});
    plusBtn.classList.add('hidden');
  });

  function rectFor(half) {
    const cRect = container.getBoundingClientRect();
    const hRect = half.getBoundingClientRect();
    const scaleX = canvas.width / cRect.width;
    const scaleY = canvas.height / cRect.height;
    return {
      x: (hRect.left - cRect.left) * scaleX,
      y: (hRect.top - cRect.top) * scaleY,
      w: hRect.width * scaleX,
      h: hRect.height * scaleY,
    };
  }

  function drawFrame() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const r1 = rectFor(camHalf);
    drawCover(ctx, video, r1.x, r1.y, r1.w, r1.h, 1);
    const r2 = rectFor(vidHalf);
    if (otherVideo.readyState >= 2 && otherVideo.videoWidth) {
      drawCover(ctx, otherVideo, r2.x, r2.y, r2.w, r2.h, 1);
    } else {
      ctx.fillStyle = '#0A3A66';
      ctx.fillRect(r2.x, r2.y, r2.w, r2.h);
    }
  }

  const tapRecorder = setupTapRecorder({
    area: camHalf,
    recIndEl: recInd,
    hintEl: hint,
    filenamePrefix: 'meio_a_meio',
    makeRecorder: () => new CanvasRecorder(canvas, drawFrame, 30),
    onSaved: () => {},
  });

  onEnter.meio = async () => {
    setFormat();
    plusBtn.classList.remove('hidden');
    otherVideo.removeAttribute('src');
    stream = await openCamera(video, 'user');
    hint.classList.remove('hidden');
    hint.textContent = 'Toque na área da câmera para iniciar a gravação';
  };
  onLeave.meio = () => {
    tapRecorder.stopAndCleanup();
    stopStream(stream);
    stream = null;
    otherVideo.pause();
    if (otherObjectUrl) { URL.revokeObjectURL(otherObjectUrl); otherObjectUrl = null; }
  };
})();

/* ============================================================
   4) EDIÇÃO DE VÍDEO — cortar trechos indesejados
   ============================================================ */
(function initEdicao() {
  const pickFileBtn = document.getElementById('ed-pickFile');
  const fromGalleryBtn = document.getElementById('ed-fromGallery');
  const fileInput = document.getElementById('ed-fileInput');
  const videoEl = document.getElementById('ed-video');
  const tools = document.getElementById('ed-tools');
  const startRange = document.getElementById('ed-startRange');
  const endRange = document.getElementById('ed-endRange');
  const startLabel = document.getElementById('ed-startLabel');
  const endLabel = document.getElementById('ed-endLabel');
  const previewBtn = document.getElementById('ed-preview');
  const addSegmentBtn = document.getElementById('ed-addSegment');
  const segmentsListEl = document.getElementById('ed-segments');
  const clearBtn = document.getElementById('ed-clearSegments');
  const exportBtn = document.getElementById('ed-export');
  const exportStatus = document.getElementById('ed-exportStatus');

  let objectUrl = null;
  let duration = 0;
  let segments = [];
  let previewStopAt = null;

  function loadFile(file) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    videoEl.src = objectUrl;
    videoEl.classList.remove('hidden');
    tools.classList.add('hidden');
    videoEl.onloadedmetadata = () => {
      duration = videoEl.duration;
      startRange.value = 0;
      endRange.value = 1000;
      updateLabels();
      tools.classList.remove('hidden');
      segments = [];
      renderSegments();
    };
  }

  pickFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  fromGalleryBtn.addEventListener('click', async () => {
    const vids = await listVideos();
    if (!vids.length) { alert('Nenhum vídeo salvo na galeria ainda.'); return; }
    const names = vids.map((v, i) => (i + 1) + ') ' + v.name).join('\n');
    const choice = prompt('Digite o número do vídeo que deseja editar:\n' + names);
    const idx = Number(choice) - 1;
    if (vids[idx]) loadFile(vids[idx].blob);
  });

  function rangeToSeconds(v) { return (Number(v) / 1000) * duration; }

  function updateLabels() {
    let s = rangeToSeconds(startRange.value);
    let e = rangeToSeconds(endRange.value);
    if (s > e) { [s, e] = [e, s]; }
    startLabel.textContent = fmtTime(s);
    endLabel.textContent = fmtTime(e);
  }
  startRange.addEventListener('input', updateLabels);
  endRange.addEventListener('input', updateLabels);

  previewBtn.addEventListener('click', () => {
    let s = rangeToSeconds(startRange.value);
    let e = rangeToSeconds(endRange.value);
    if (s > e) [s, e] = [e, s];
    videoEl.currentTime = s;
    previewStopAt = e;
    videoEl.play();
  });
  videoEl.addEventListener('timeupdate', () => {
    if (previewStopAt !== null && videoEl.currentTime >= previewStopAt) {
      videoEl.pause();
      previewStopAt = null;
    }
  });

  function renderSegments() {
    segmentsListEl.innerHTML = '';
    if (!segments.length) {
      segmentsListEl.innerHTML = '<p style="font-size:12px;opacity:.8;">Nenhum trecho adicionado ainda.</p>';
      return;
    }
    segments.forEach((seg, i) => {
      const row = document.createElement('div');
      row.className = 'segment-row';
      row.innerHTML = `<span class="grow">Trecho ${i + 1}: ${fmtTime(seg.start)} → ${fmtTime(seg.end)}</span>
        <button data-i="${i}">Remover</button>`;
      row.querySelector('button').addEventListener('click', () => {
        segments.splice(i, 1);
        renderSegments();
      });
      segmentsListEl.appendChild(row);
    });
  }

  addSegmentBtn.addEventListener('click', () => {
    let s = rangeToSeconds(startRange.value);
    let e = rangeToSeconds(endRange.value);
    if (s > e) [s, e] = [e, s];
    if (e - s < 0.2) { alert('Selecione um trecho com pelo menos alguns décimos de segundo.'); return; }
    segments.push({ start: s, end: e });
    renderSegments();
  });

  clearBtn.addEventListener('click', () => { segments = []; renderSegments(); });

  exportBtn.addEventListener('click', async () => {
    if (!segments.length) { alert('Adicione ao menos um trecho à lista antes de gerar o vídeo.'); return; }
    exportBtn.disabled = true;
    exportStatus.textContent = 'Gerando vídeo, aguarde...';

    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 720;
    canvas.height = videoEl.videoHeight || 1280;
    const ctx = canvas.getContext('2d');
    function drawFrame() { drawCover(ctx, videoEl, 0, 0, canvas.width, canvas.height, 1); }

    const rec = new CanvasRecorder(canvas, drawFrame, 30);
    rec.start();
    videoEl.muted = false;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      exportStatus.textContent = `Processando trecho ${i + 1} de ${segments.length}...`;
      await new Promise((resolve) => {
        videoEl.currentTime = seg.start;
        const onSeeked = () => {
          videoEl.removeEventListener('seeked', onSeeked);
          videoEl.play();
          const check = () => {
            if (videoEl.currentTime >= seg.end || videoEl.paused) {
              videoEl.pause();
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        };
        videoEl.addEventListener('seeked', onSeeked);
      });
    }

    const blob = await rec.stop();
    videoEl.muted = true;
    exportStatus.textContent = 'Pronto! Baixando o vídeo final...';
    const ext = extFromMime(rec.mimeType || 'video/webm');
    const filename = 'editado_' + Date.now() + '.' + ext;
    downloadBlob(blob, filename);
    await saveVideo({ name: filename, blob, source: 'edicao' });
    exportStatus.textContent = 'Vídeo final gerado e salvo na galeria!';
    exportBtn.disabled = false;
  });

  onLeave.edicao = () => {
    videoEl.pause();
  };
})();

/* ============================================================
   6) GALERIA DE VÍDEOS
   ============================================================ */
(function initGaleria() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');

  async function render() {
    grid.innerHTML = '';
    const vids = await listVideos();
    empty.classList.toggle('hidden', vids.length > 0);
    vids.forEach((v) => {
      const url = URL.createObjectURL(v.blob);
      const item = document.createElement('div');
      item.className = 'gallery-item';
      const dateStr = new Date(v.date).toLocaleString('pt-BR');
      item.innerHTML = `
        <video src="${url}" controls playsinline preload="metadata"></video>
        <div class="meta">
          <div class="name">${v.name}</div>
          <div>${dateStr}</div>
        </div>
        <div class="actions">
          <button data-act="download">⬇ Baixar</button>
          <button data-act="delete">🗑 Excluir</button>
        </div>`;
      item.querySelector('[data-act="download"]').addEventListener('click', () => downloadBlob(v.blob, v.name));
      item.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (confirm('Excluir este vídeo salvo?')) {
          await deleteVideo(v.id);
          render();
        }
      });
      grid.appendChild(item);
    });
  }

  onEnter.videos = render;
})();

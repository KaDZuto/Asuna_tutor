// Live2D-аватар в окне Tutor. Движок и модели перенесены из Asuna VectorHeart:
// resources/libs (PIXI 5 + pixi-live2d-display + Cubism2 Core) и resources/models/<id>.
// Схема загрузки повторяет renderer/app.js Асунны: PIXI.live2d.Live2DModel.from(model.json),
// anchor по центру, масштаб от высоты контейнера, focus за курсором, hitTest по клику.

const el = (id) => document.getElementById(id);

const pet = {
  app: null,
  model: null,
  id: null,
  manifest: { expressions: [], motions: {} },
  scale: 1,
  ready: false,
  mouth: 0
};

const voice = { ctx: null, source: null, analyser: null, data: null, gain: 0 };

function stopSpeech() {
  try { if (voice.source) voice.source.stop(0); } catch {}
  voice.source = null;
  voice.gain = 0;
  pet.mouth = 0;
  setMouth(0);
}

function setMouth(level) {
  if (!pet.model) return;
  const core = pet.model.internalModel && pet.model.internalModel.coreModel;
  if (!core) return;
  try { core.setParameterValueById('PARAM_MOUTH_OPEN_Y', level); } catch {}
}

async function speak(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  stopSpeech();
  const res = await window.tutorAPI.ttsSynth(clean);
  if (!res || !res.ok || !res.bytes || !res.bytes.length) {
    console.warn('[tts]', (res && res.error) || 'нет аудио');
    return;
  }
  try {
    const pcm = new Uint8Array(res.bytes);
    voice.ctx = voice.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (voice.ctx.state === 'suspended') await voice.ctx.resume();
    const audio = await voice.ctx.decodeAudioData(pcm.buffer);
    const src = voice.ctx.createBufferSource();
    src.buffer = audio;
    const analyser = voice.ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(voice.ctx.destination);
    voice.source = src;
    voice.analyser = analyser;
    voice.data = new Uint8Array(analyser.fftSize);
    voice.gain = 1;
    src.onended = stopSpeech;
    src.start(0);
  } catch (e) {
    console.warn('[tts]', e.message);
    voice.gain = 0;
  }
}

function mouthTick() {
  if (!pet.model) return;
  let level = 0;
  if (voice.source && voice.analyser && voice.data) {
    voice.analyser.getByteTimeDomainData(voice.data);
    let sum = 0;
    for (let i = 0; i < voice.data.length; i++) {
      const v = (voice.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / voice.data.length);
    level = Math.min(1, Math.pow(rms * 6, 0.85));
  }
  pet.mouth = pet.mouth * 0.55 + level * 0.45;
  setMouth(pet.mouth);
}

function setStatus(text, cls) {
  const box = el('pet');
  if (!box) return;
  box.classList.remove('loading', 'error');
  if (cls) box.classList.add(cls);
  const chip = el('petchip');
  if (chip) chip.textContent = text;
}

function layout() {
  if (!pet.model || !pet.app) return;
  const stage = el('petstage');
  if (!stage) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w < 10 || h < 10) return;
  pet.model.position.set(w / 2, h / 2 + h * 0.06);
  const base = (h * 0.86) / pet.model.height;
  pet.model.scale.set(base * pet.scale);
}

function destroyModel() {
  if (!pet.model || !pet.app) return;
  try { pet.app.stage.removeChild(pet.model); } catch {}
  try { pet.model.destroy({ children: true, texture: true, baseTexture: true }); } catch {}
  pet.model = null;
  pet.ready = false;
}

async function loadModel(id) {
  if (!id || typeof PIXI === 'undefined' || !PIXI.live2d) return;
  if (id === pet.id && pet.model) return;
  destroyModel();
  pet.id = id;
  setStatus('ЗАГРУЗКА…', 'loading');
  try {
    const url = `../resources/models/${id}/${id}.model.json`;
    const model = await PIXI.live2d.Live2DModel.from(url);
    pet.model = model;
    model.anchor.set(0.5, 0.5);
    model.autoInteract = true;
    pet.app.stage.addChild(model);
    layout();
    pet.manifest = (await window.tutorAPI.avatarManifest(id)) || { expressions: [], motions: {} };
    pet.ready = true;
    setStatus(id.toUpperCase().replace('ASUNA_', 'ASUNA '));
    [el('model-picker'), el('model-picker-side')].filter(Boolean).forEach((p) => { if (p.value !== id) p.value = id; });
    applyExpression('F_NOMAL');
    playMotion('idle');
  } catch (err) {
    console.error('[avatar] load error', id, err);
    pet.model = null;
    pet.ready = false;
    setStatus('ОШИБКА ЗАГРУЗКИ', 'error');
  }
}

function applyExpression(name) {
  if (!pet.model || !name) return false;
  const key = String(name).trim();
  let found = pet.manifest.expressions.findIndex((e) => e.name === key);
  if (found < 0) found = pet.manifest.expressions.findIndex((e) => e.name.toUpperCase() === key.toUpperCase());
  if (found < 0) {
    found = pet.manifest.expressions.findIndex((e) => e.name.includes(key.toUpperCase()));
  }
  if (found < 0) {
    console.warn('[avatar] expression not in manifest:', key);
    return false;
  }
  pet.model.expression(found);
  return true;
}

function playMotion(group, index) {
  if (!pet.model) return false;
  const motions = pet.manifest.motions || {};
  let g = group;
  if (!(g in motions)) {
    const key = String(group || '').toLowerCase();
    g = Object.keys(motions).find((k) => k.toLowerCase() === key || k.toLowerCase().includes(key));
  }
  if (!g) {
    console.warn('[avatar] motion group not in manifest:', group);
    return false;
  }
  const list = motions[g] || [];
  const i = Number.isInteger(index) ? index : 0;
  pet.model.motion(g, Math.min(i, Math.max(list.length - 1, 0)));
  return true;
}

// <AVATAR>{"expression":"F_FUN","motion":"idle"}</AVATAR> — тег не показывается в чате.
function avatarParse(text) {
  if (!text) return text;
  let spec = null;
  const m = String(text).match(/<AVATAR>([\s\S]*?)<\/AVATAR>/i);
  const clean = String(text).replace(/<AVATAR>[\s\S]*?<\/AVATAR>/gi, '').trim();
  if (m) {
    try { spec = JSON.parse(m[1].trim()); } catch { spec = null; }
  }
  if (spec) {
    if (spec.expression) applyExpression(spec.expression);
    if (spec.motion) playMotion(spec.motion, spec.motion_index);
  } else if (pet.model) {
    playMotion('idle');
  }
  return clean;
}

function expressionHint() {
  const names = pet.manifest.expressions.map((e) => e.name).filter(Boolean);
  const groups = Object.keys(pet.manifest.motions || {});
  return `Доступные выражения: ${names.join(', ') || 'нет'}.\nДоступные группы движений: ${groups.join(', ') || 'нет'}.`;
}

function initEngine() {
  const canvas = el('pet-canvas');
  const stage = el('petstage');
  if (!canvas || !stage) return;
  if (typeof PIXI === 'undefined' || !PIXI.Application) {
    setStatus('PIXI НЕ ЗАГРУЖЕН', 'error');
    return;
  }
  pet.app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    resizeTo: stage,
    transparent: true,
    antialias: true,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  });
  stage.addEventListener('mousemove', (e) => {
    if (pet.model) pet.model.focus(e.clientX, e.clientY);
  });
  stage.addEventListener('click', (e) => {
    if (!pet.model) return;
    const rect = canvas.getBoundingClientRect();
    const hit = pet.model.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      playMotion('idle');
      applyExpression(Math.random() < 0.5 ? 'F_FUN' : 'F_NOMAL');
    }
  });
  if (pet.app.ticker) pet.app.ticker.add(mouthTick, null, PIXI.UPDATE_PRIORITY.LOW);
  window.addEventListener('resize', layout);
}

async function init() {
  initEngine();
  const saved = (await window.tutorAPI.avatarGet()) || {};
  pet.scale = saved.scale || 1;
  const models = (await window.tutorAPI.avatarList()) || [];
  const options = models.map((m) => `<option value="${m.id}">${m.id.toUpperCase().replace('ASUNA_', 'ASUNA ')} · ${m.expressions} exp / ${m.motions} mtn</option>`).join('');
  const pickers = [el('model-picker'), el('model-picker-side')].filter(Boolean);
  pickers.forEach((p) => {
    p.innerHTML = options;
    p.addEventListener('change', async () => {
      pickers.forEach((o) => { o.value = p.value; });
      await loadModel(p.value);
      await window.tutorAPI.avatarSet({ id: pet.id, scale: pet.scale });
    });
  });
  if (saved.visible === false) el('pet')?.classList.add('collapsed');
  el('pettoggle')?.addEventListener('click', () => {
    const box = el('pet');
    box.classList.toggle('collapsed');
    window.tutorAPI.avatarSet({ visible: !box.classList.contains('collapsed') });
    setTimeout(layout, 60);
  });
  const startId = saved.id && models.some((m) => m.id === saved.id) ? saved.id : (models[0] && models[0].id);
  if (startId) await loadModel(startId);
  else setStatus('АВАТАР НЕ УСТАНОВЛЕН', 'error');
  window.tutorAvatar = {
    play: (spec) => {
      if (!spec) return false;
      let ok = false;
      if (spec.expression) ok = applyExpression(spec.expression) || ok;
      if (spec.motion) ok = playMotion(spec.motion, spec.motion_index) || ok;
      return ok;
    },
    hint: expressionHint,
    snapshot: () => {
      if (!pet.app) return null;
      try {
        const c = pet.app.renderer.extract.canvas(pet.app.stage);
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let painted = 0;
        for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) painted++;
        return { w: c.width, h: c.height, painted };
      } catch (e) { return { error: String(e.message || e) }; }
    },
    load: (id) => loadModel(id),
    speak,
    stopSpeech,
    relayout: () => { if (pet.app) pet.app.resize(); layout(); },
    state: () => ({ id: pet.id, ready: pet.ready, expressions: pet.manifest.expressions.length, motions: Object.keys(pet.manifest.motions || {}) })
  };
}

window.addEventListener('DOMContentLoaded', init);

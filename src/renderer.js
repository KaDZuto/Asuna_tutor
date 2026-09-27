const byId = (id) => document.getElementById(id);

let materials = [];
let session = { messages: [], board: [] };
let profile = {};
let busy = false;
let skipImages = false;

const MODE_DIRECTIVE = {
  diagnose: 'РЕЖИМ: ДИАГНОСТИКА. Только вопросы, никаких объяснений и решений. Задай ОДИН калиброванный вопрос, дождись ответа, оцени уровень и выбери следующий вопрос: чуть проще или чуть сложнее. Не задавай два вопроса сразу. Когда пробел найден, зафиксируй его в <PROFILE> и скажи студенту одну фразу о том, что именно будем чинить. Пять-семь таких вопросов — и у тебя есть карта пробелов.',
  explain: 'РЕЖИМ: ОБЪЯСНЕНИЕ ТЕМЫ. Один концепт за реплику: сначала зачем он нужен, потом смысл своими словами, потом один конкретный пример, потом контрпример или "когда ломается". В конце — ровно одна мини-проверка вопросом. Длинные перечисления запрещены: если тема сложная, разбей её и договорись со студентом, с какой части начинаем.',
  prepare: 'РЕЖИМ: ПОДГОТОВКА К ЭКЗАМЕНУ. Сначала собери план: темы, их приоритет по твоей оценке, сроки, интервальное повторение. Затем начни с самого слабого места. Чередуй разные типы задач, не гоняй один тип. Каждый блок заканчивай одним пробным заданием. План и сроки фиксируй в <PROFILE>.',
  practice: 'РЕЖИМ: ТРЕНИРОВКА. Ты выдаёшь задачу — студент решает. Не решай за него. Если неверно: одна наводящая подсказка. Если снова неверно: вторая подсказка, уже с методом. Только после явной просьбы ("покажи решение") — полный разбор. Ошибки записывай в <PROFILE>, чтобы не повторять их потом.',
  solve: 'РЕЖИМ: РАЗБОР ЗАДАЧИ. Веди студента по шагам и после каждого шага отдавай мяч: "твоя очередь — найди характеристическое уравнение". Не выдавай весь ход решения сразу. Перед каждым шагом спроси, понимает ли он предыдущий. В конце проси студента повторить метод своими словами и проверь условия применимости.',
  quiz: 'РЕЖИМ: ТЕСТИРОВАНИЕ. Ты экзаменатор. Выдай ОДНО задание, дождись ответа, проверь, поставь вердикт и только потом (если ошибка) разбери её в двух-трёх предложениях. Дальше — следующее задание. Соблюдай параметры теста из запроса: тема, сложность, количество. Типы заданий смешивай: короткий ответ с числом/формулой, «да/нет с обоснованием», задача на один шаг, на порядок уравнения, на ОДЗ и посторонние корни. Варианты с числовым ответом обязательно приводи к точному виду и указывай, что считать ответом (округление, коэффициенты). Каждый проверенный ответ и каждая ошибка попадают в <PROFILE>. В конце теста — счёт: правильно из N, и три конкретных совета по слабейшим местам.',
  check: 'РЕЖИМ: ПРОВЕРКА РЕШЕНИЯ. Студент прислал своё решение. Твоя задача — проверить его честно и по шагам. Сначала короткий вердикт одним словом: ВЕРНО, ВЕРНО С ОШИБКОЙ или НЕВЕРНО. Затем пошаговая проверка: пройди его строки по порядку и отметь, где логика верная, а где ошибка. Назови конкретную причину ошибки (потерян знак, недопустимое деление, потеряно условие при делении, не проверены граничные условия, перепутан порядок производных, ошибка в граничных условиях, неучтённое частное решение). Если решение верно с ошибочным оформлением или недоказанным шагом — скажи это прямо. Если в условии не хватает данных или задача неоднозначна — скажи и задай ОДИН уточняющий вопрос. Никогда не помечай верный ответ как неверный: перепроверь сам, прежде чем ставить вердикт. Сравни с эталоном честно, но сначала дай студенту шанс увидеть, где именно он свернул.'
};

const SYSTEM = `Ты — Асуна, персональный репетитор по дифференциальным уравнениям и уравнениям математической физики. Твоя работа — не выдавать ответы, а довести студента до самостоятельного владения темой. Ты работаешь как сильный преподаватель, а не как справочник.

МЕТОДИКА (обязательные правила поведения):
1. Ритм: одна реплика = одна мысль = максимум ОДИН вопрос. Закончил вопрос — СТОП и жди ответа студента. Никогда не задавай два вопроса в одной реплике.
2. Длина: 2–6 строк. Запрещены простыни, списки из 15 пунктов и пересказ учебника. Если информации много — спроси, с какой части продолжить, или разбей на занятия.
3. Не выдавай решение, пока студент не попытался. Сначала спроси, как он собирается решать. Если неудачных попыток две или студент прямо просит решение — тогда разбор, и сначала спроси, что именно он понял из своих попыток.
4. Подсказки в три уровня: (1) наводящий вопрос, (2) метод/инструмент, (3) первый шаг с формулой. Переходи к следующему уровню только после неудачной попытки, и говори, какой уровень ты даёшь.
5. Ошибку исправляй через вопрос, а не через приговор. Вместо "неправильно": "проверь знак в третьей строке — потерян ли он при делении?". Потом, если студент не увидел, объясни причину и покажи правильный шаг.
6. Обратная связь по ходу решения (process feedback), а не только по ответу: отмечай, где студент рассуждает верно, и где рисковал.
7. Когнитивная нагрузка: один новый концепт за раз, сначала пример, потом обобщение, всегда опирайся на то, что студент уже умеет. Не вводи термин раньше, чем он понадобился.
8. Мышление роста: ошибка — это данные, а не приговор. "Здесь ошибаются почти все" работает лучше, чем "это элементарно".
9. Проверяй себя как преподаватель: спрашивай про ОДЗ, размерность, порядок, непрерывность, эквивалентность преобразований, выполнение граничных и начальных условий. Симметричные решения и потери решений при делении — обязательно.
10. Материалы: опирайся на загруженные файлы. Не выдумывай их содержимое; если материала не хватает — прямо скажи, что нужно загрузить.
11. Освоенной считай тему, когда студент верно решает две разнородные задачи подряд. Иначе тема остаётся в списке слабых.
12. Повторение: назначай интервальное повторение 1, 3, 7, 14 дней на каждую закрытую тему и записывай дату следующего повторения в <PROFILE>.

ПРОВЕРКА ОТВЕТОВ И РАБОТ (обязательно для режимов quiz и check):
- Верь только тому, что реально прислал студент, не додумывай недостающие шаги.
- Перепроверь вычисление сам, прежде чем выносить вердикт: ошибочно помеченный верный ответ хуже, чем задержка с проверкой.
- Принимай эквивалентные формы: $e^{\\ln 5}=5$, $\\ln 5e$, $5$ — это одно и то же. Считай $2x$ и $-2x$ разными, $0$ и $0.00$ — одинаковыми.
- Вердикт строго в первой строке: ВЕРНО, ВЕРНО С ОШИБКОЙ или НЕВЕРНО. Потом — проверка по шагам студента.
- Называй причину ошибки конкретно и покажи исправленный шаг.
- Засчитывай в <PROFILE> каждую проверенную попытку: что было заданием, верно или нет, какая ошибка, какой вывод.

ДОМЕН: для ДУ держи в голове порядок, линейность и нелинейность, автономность, условия существования и единственности, фазовые портреты, устойчивость, характеристическое уравнение, метод Лапласа, интегрирующий множитель, разложение по степеням, фундаментальная система решений, ряд Фурье, задача на смешанные начальные и граничные условия. Для УМФ: классификация PDE, характеристики, канонический вид, метод разделения переменных, режим установившихся колебаний, теплопроводность, уравнение колебаний на струне, уравнение Лапласа, телеграфное уравнение, краевые задачи, параболические и гиперболические задачи, теорема Грина.

ФОРМАТ ОТВЕТА:
- Обычный текст в Markdown: **жирный** для терминов, списки короткие, \`код\` для символов и обозначений.
- Формулы — только LaTeX: $...$ для строки и $$...$$ для выделенной формулы. Никаких сырых _x^2_ или \\frac вне формул.
- В конце ответа ровно три блока, без лишних тегов внутри:
<BOARD>
TITLE: заголовок блока
NOTE: короткая мысль
FORMULA: $$\frac{dy}{dx}=f(x,y)$$
STEP: следующий шаг
CHECK: проверка (ОДЗ, размерность, границы)
QUESTION: вопрос к студенту
</BOARD>
<AVATAR>{"expression":"имя выражения","motion":"группа движений"}</AVATAR>
<PROFILE>{"goal":"","level":"","topics":[],"weak":[{"topic":"","symptom":""}],"mastered":[],"mistakes":[{"task":"","error":"","fix":"","date":""}],"review":[{"topic":"","due":""}],"next":"","conventions":""}</PROFILE>
- В <AVATAR> подставляй только имена, перечисленные в запросе.
- В <BOARD> пиши только то, что реально относится к текущему шагу, а не весь конспект.
- В <PROFILE> обновляй только то, что изменилось: пробелы, освоенное, ошибки, план повторения. Не переписывай историю целиком.

ПЕРВОЕ СООБЩЕНИЕ В НОВОЙ СЕССИИ: коротко поприветствуй, напомни цель и график повторения из <PROFILE>, назови тему сегодняшнего занятия и сразу задай ОДИН вопрос.`;

const AVATAR_PLACEHOLDER = 'выражения недоступны';

// ── Зрение модели ────────────────────────────────────────────────────────────
// Многие OpenAI-совместимые серверы принимают image_url молча и выбрасывают
// картинку: ответ приходит уверенный, но модель его выдумала. Поэтому перед
// отправкой фото проверяем модель настоящей пробой — рисуем случайные цифры
// на canvas и смотрим, назовёт ли она их. Ничего сверх одного запроса.
let vision = { status: 'unknown' };
let visionCache = {};
let visionOverride = {};
let probing = false;
let lastProbe = {};

function probeImage() {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 120;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const digits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
  g.fillStyle = '#000';
  g.font = 'bold 96px monospace';
  g.textBaseline = 'middle';
  g.fillText(digits, 20, 64);
  return { png: c.toDataURL('image/jpeg', 0.85), digits };
}

async function rawChat(messages) {
  const res = await fetch(byId('api').value.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(byId('key').value ? { Authorization: 'Bearer ' + byId('key').value } : {}) },
    body: JSON.stringify({ model: byId('model').value, messages, temperature: 0, max_tokens: 32 }),
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const d = await res.json();
  return String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '');
}

async function runVisionProbe() {
  const { png, digits } = probeImage();
  const answer = await rawChat([{ role: 'user', content: [{ type: 'text', text: 'Назови только цифры, нарисованные на картинке. Без пояснений.' }, { type: 'image_url', image_url: { url: png } }] }]);
  return answer.replace(/\D/g, '') === digits;
}

function looksLikeVision(id) {
  return /(^|[:/_-])(vl|vision|llava|bakllava|moondream|minicpmv?|gemma3|gemma-3|internvl|pixtral|idefics|smolvlm|qwen\d?\.?-?vl)/i.test(String(id || ''));
}

async function visionStatus(force) {
  const model = byId('model').value;
  if (visionOverride[model]) return visionOverride[model];
  if (!force && visionCache[model]) return visionCache[model];
  if (!force) {
    const list = await window.tutorAPI.llmModels(byId('api').value);
    const found = list.find((m) => m.id === model);
    if (found && (found.vision || looksLikeVision(model))) {
      visionCache[model] = 'vision';
      return 'vision';
    }
    if (visionCache[model] === 'unknown' && Date.now() - (lastProbe[model] || 0) < 300000) return 'unknown';
  }
  if (probing) return visionCache[model] || 'unknown';
  probing = true;
  lastProbe[model] = Date.now();
  try {
    visionCache[model] = (await runVisionProbe()) ? 'vision' : 'blind';
  } catch (e) {
    visionCache[model] = 'unknown';
    console.warn('[vision] проба не удалась:', e && e.message);
  } finally {
    probing = false;
  }
  return visionCache[model];
}

function visionText(st) {
  if (st === 'vision') return 'модель читает фото';
  if (st === 'blind') return 'модель НЕ читает фото';
  return 'зрение не проверено, фото могут быть проигнорированы';
}

function renderAttachInfo() {
  const imgs = materials.filter((x) => x.type === 'image');
  const bad = materials.filter((x) => x.type === 'unsupported');
  const box = byId('attachinfo');
  if (!box) return;
  const parts = [];
  if (imgs.length) {
    const st = vision.status;
    const cls = st === 'vision' ? 'ok' : st === 'blind' ? 'bad' : '';
    parts.push(`<span class="llmstatus ${cls}" style="margin:0">📷 ${imgs.length} фото · ${visionText(st)}</span>`);
  }
  if (bad.length) parts.push(`<span class="llmstatus bad" style="margin:0">⚠ ${bad.length} файл не прочитан</span>`);
  box.innerHTML = parts.join(' ');
  box.hidden = !parts.length;
}

async function refreshVisionStatus() {
  vision.status = await visionStatus();
  renderAttachInfo();
  const box = byId('visionstatus');
  if (box) {
    const cls = vision.status === 'vision' ? 'ok' : vision.status === 'blind' ? 'bad' : '';
    box.className = 'llmstatus ' + cls;
    box.textContent = `${byId('model').value}: ${visionText(vision.status)}`;
  }
  const force = byId('visionforce');
  if (force) force.checked = !!visionOverride[byId('model').value];
  console.info('[vision]', byId('model').value, '→', vision.status);
}

let character = null;
function personaBlock() {
  if (!character) return '';
  const lines = [`Ты — ${character.name}, ${character.title}.`];
  (character.persona || []).forEach((p) => lines.push(`- ${p}`));
  if (character.voice && character.voice.reply_lines) lines.push(`Длина ответа: ${character.voice.reply_lines} строк. Вопросов в реплике: не больше ${character.voice.max_questions_per_reply || 1}.`);
  return lines.join('\n');
}

function stripTags(text) {
  return String(text || '')
    .replace(/<BOARD>[\s\S]*?<\/BOARD>/gi, '')
    .replace(/<AVATAR>[\s\S]*?<\/AVATAR>/gi, '')
    .replace(/<PROFILE>[\s\S]*?<\/PROFILE>/gi, '')
    .trim();
}

const md = new window.markdownit({ html: false, breaks: true, linkify: true });

function renderMarkdown(node, text) {
  node.innerHTML = md.render(text);
  if (window.renderMathInElement) {
    window.renderMathInElement(node, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false, strict: false },
        { left: '\\(', right: '\\)', display: false, strict: false }
      ],
      throwOnError: false,
      trust: false
    });
  }
}

function scrollChat() {
  const box = byId('messages');
  box.scrollTop = box.scrollHeight;
}

function addMsg(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const label = document.createElement('div');
  label.className = 'role';
  label.textContent = role === 'user' ? 'Ты' : 'Асуна';
  const body = document.createElement('div');
  body.className = 'body';
  renderMarkdown(body, text);
  wrap.append(label, body);
  byId('messages').appendChild(wrap);
  requestAnimationFrame(scrollChat);
  return wrap;
}

function boardParse(text) {
  const m = String(text).match(/<BOARD>([\s\S]*?)<\/BOARD>/i);
  if (!m) return;
  const html = [];
  for (const raw of m[1].split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const push = (cls, prefix, content) => html.push(`<div class="note ${cls}">${prefix ? `<b>${prefix}</b> ` : ''}${md.renderInline(content)}</div>`);
    if (/^TITLE\s*:/i.test(line)) html.push(`<h2>${md.renderInline(line.replace(/^TITLE\s*:/i, ''))}</h2>`);
    else if (/^FORMULA\s*:/i.test(line)) html.push(`<div class="formula">${line.replace(/^FORMULA\s*:/i, '').trim()}</div>`);
    else if (/^STEP\s*:/i.test(line)) push('step', 'Шаг.', line.replace(/^STEP\s*:/i, ''));
    else if (/^CHECK\s*:/i.test(line)) push('check', 'Проверка.', line.replace(/^CHECK\s*:/i, ''));
    else if (/^QUESTION\s*:/i.test(line)) push('question', 'Вопрос.', line.replace(/^QUESTION\s*:/i, ''));
    else if (/^NOTE\s*:/i.test(line)) push('note', '', line.replace(/^NOTE\s*:/i, ''));
  }
  if (!html.length) return;
  const paper = byId('board');
  paper.innerHTML = html.join('');
  paper.querySelectorAll('.formula').forEach((f) => {
    if (window.renderMathInElement) window.renderMathInElement(f, { delimiters: [{ left: '$$', right: '$$', display: true }], throwOnError: false });
  });
  paper.scrollTop = 0;
}

function profileParse(text) {
  const m = String(text).match(/<PROFILE>([\s\S]*?)<\/PROFILE>/i);
  if (!m) return;
  let data;
  try { data = JSON.parse(m[1].trim()); } catch { return; }
  profile = Object.assign(profile, data);
  window.tutorAPI.profileSet(profile).then((p) => { profile = p; renderProfile(); });
}

function renderProfile() {
  const box = byId('profiledata');
  if (!box) return;
  const list = (title, arr, fmt) => {
    if (!Array.isArray(arr) || !arr.length) return '';
    return `**${title}:** ${arr.map(fmt).join('; ')}`;
  };
  const parts = [];
  if (profile.goal) parts.push(`**Цель:** ${profile.goal}`);
  if (profile.level) parts.push(`**Уровень:** ${profile.level}`);
  if (profile.conventions) parts.push(`**Обозначения:** ${profile.conventions}`);
  if (profile.next) parts.push(`**Дальше:** ${profile.next}`);
  parts.push(list('Слабые места', profile.weak, (w) => (typeof w === 'string' ? w : `${w.topic || ''}${w.symptom ? ` (${w.symptom})` : ''}`)));
  parts.push(list('Освоено', profile.mastered, (m) => (typeof m === 'string' ? m : m.topic || '')));
  parts.push(list('Ошибки', profile.mistakes, (m) => (typeof m === 'string' ? m : `${m.error || ''} → ${m.fix || ''}`)));
  parts.push(list('Повторить', profile.review, (r) => (typeof r === 'string' ? r : `${r.topic || ''} (${r.due || ''})`)));
  renderMarkdown(box, parts.filter(Boolean).join('\n\n') || '*Профиль пуст — он заполнится после первого занятия.*');
}

function systemPrompt() {
  const hint = (window.tutorAvatar && window.tutorAvatar.hint) ? window.tutorAvatar.hint() : AVATAR_PLACEHOLDER;
  const dir = MODE_DIRECTIVE[byId('mode').value] || MODE_DIRECTIVE.explain;
  const profileBlock = renderProfileToText();
  return `${SYSTEM}\n\n=== ПЕРСОНА ===\n${personaBlock()}\n\n=== ПРОФИЛЬ СТУДЕНТА (память прошлых сессий) ===\n${profileBlock}\n\n=== РЕЖИМ ===\n${dir}\n\n=== АВАТАР ===\n${hint}`;
}

function renderProfileToText() {
  const f = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : (v || '—'));
  return [
    `Цель: ${profile.goal || '—'}`,
    `Уровень: ${profile.level || '—'}`,
    `Обозначения студента: ${profile.conventions || '—'}`,
    `Слабые места: ${f(profile.weak)}`,
    `Освоено: ${f(profile.mastered)}`,
    `Ошибки: ${f(profile.mistakes)}`,
    `План повторения: ${f(profile.review)}`,
    `Ближайшая задача: ${profile.next || '—'}`
  ].join('\n');
}

function historyForRequest() {
  const keep = session.messages.slice(-16);
  const out = keep.map((m) => ({ role: m.role, content: m.role === 'user' ? m.content : stripTags(m.content) }));
  if (out.length && out[0].role !== 'user' && !/начнём|начнем|привет|заново/i.test(out[0].content)) out.shift();
  return out;
}

async function callLLM() {
  const api = byId('api').value.replace(/\/$/, '');
  const model = byId('model').value;
  const key = byId('key').value;
  const mode = byId('mode').value;
  const materialText = materials.filter((x) => x.type === 'text').map((x) => `### ${x.name}\n${x.text.slice(0, 40000)}`).join('\n\n');
  const dropped = materials.filter((x) => x.type === 'image' && skipImages).map((x) => x.name);
  const images = skipImages ? [] : materials.filter((x) => x.type === 'image').slice(0, 8);
  const skipped = materials.filter((x) => x.type === 'unsupported').map((x) => `${x.name} (${x.note || 'не читается'})`);
  let extra = '';
  if (dropped.length) extra += `\n\nВнимание: изображения (${dropped.join(', ')}) НЕ были переданы — модель их не получила. Не ссылайся на то, что видишь на них.`;
  if (skipped.length) extra += `\n\nНе удалось прочитать файлы: ${skipped.join('; ')}. Скажи об этом студенту и попроси перезагрузить их в поддерживаемом формате.`;
  if (mode === 'quiz') {
    extra += `\n\nПараметры теста: тема — ${byId('q_topic').value.trim() || 'выбери сам из моих слабых мест'}, сложность — ${byId('q_level').value}, количество заданий — ${byId('q_count').value}. Выдай только ПЕРВОЕ задание, ответ дождись от меня, потом проверь и выдай следующее. В конце последнего задания — счёт и три совета.`;
  }
  if (mode === 'check') {
    extra += `\n\nНиже моё решение на проверку. Проверь его по шагам, начиная с вердикта, и назови конкретную причину любой ошибки.`;
  }
  const content = [{
    type: 'text',
    text: `Режим: ${byId('mode').selectedOptions[0].textContent}\n\nМатериалы:\n${materialText || 'не загружены'}${images.length ? `\n\nК тебе прикреплено изображений: ${images.length}. Отвечай по тому, что реально на них видно; если не видно — скажи об этом прямо.` : ''}${extra}\n\nСообщение: ${byId('prompt').value}`
  }];
  for (const im of images) content.push({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } });
  const messages = [{ role: 'system', content: systemPrompt() }, ...historyForRequest(), { role: 'user', content }];
  const res = await fetch(api + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2200 })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Модель не вернула ответ.';
}

function speakAnswer(text) {
  if (!byId('tts').checked || !window.tutorAvatar || !window.tutorAvatar.speak) return;
  const spoken = text.replace(/\$\$?[\s\S]*?\$\$?/g, ' формула ').replace(/`[^`]*`/g, '').replace(/[*#>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (spoken) window.tutorAvatar.speak(spoken.slice(0, 900));
}

async function send(skipVisionCheck) {
  if (busy) return;
  const q = byId('prompt').value.trim();
  if (!q) return;
  const pendingImages = materials.filter((x) => x.type === 'image');
  if (pendingImages.length && !skipVisionCheck) {
    const st = await visionStatus();
    vision.status = st;
    renderAttachInfo();
    if (st === 'blind') {
      const node = addMsg('assistant', `Фото не отправлены: модель **${byId('model').value}** не читает изображения — она получила только текст и ответит наугад.\n\nЧто сделать: в панели «Модель» проверь зрение кнопкой «Проверить зрение» и поставь модель с vision (например \`qwen2.5vl\`, \`gemma3\`, \`llama3.2-vision\` на Ollama или любой VLM у провайдера). Либо отправь сообщение с **Shift+Enter** — тогда уйдёт текст без фото.`);
      node.classList.add('error');
      return;
    }
    if (st === 'unknown') {
      const node = addMsg('assistant', `Не смогла проверить, читает ли модель **${byId('model').value}** изображения. Отправляю с фото — если она начнёт описывать то, чего на фото нет, значит картинка потерялась по дороге. Проверить принудительно: панель «Модель» → «Проверить зрение модели».`);
      node.classList.add('error');
    }
  }
  skipImages = !!skipVisionCheck;
  busy = true;
  byId('send').disabled = true;
  if (window.tutorAvatar) window.tutorAvatar.stopSpeech();
  addMsg('user', q);
  session.messages.push({ role: 'user', content: q });
  byId('prompt').value = '';
  byId('typing').hidden = false;
  try {
    const answer = await callLLM();
    const visible = stripTags(answer);
    const node = addMsg('assistant', visible);
    if (/^Ошибка подключения/.test(visible)) node.classList.add('error');
    boardParse(answer);
    profileParse(answer);
    if (window.tutorAvatar) avatarParse(answer);
    session.messages.push({ role: 'assistant', content: answer });
    await window.tutorAPI.saveSession(session);
    speakAnswer(visible);
  } catch (e) {
    const node = addMsg('assistant', `Ошибка подключения к модели: ${e.message}`);
    node.classList.add('error');
  } finally {
    byId('typing').hidden = true;
    busy = false;
    byId('send').disabled = false;
    scrollChat();
  }
}

function renderFiles() {
  byId('files').innerHTML = materials.map((x) => {
    if (x.type === 'unsupported') return `<div class="file warn">⚠ ${escapeHtml(x.name)} — ${escapeHtml(x.note || 'не читается')}</div>`;
    if (x.type === 'image') return `<div class="file">🖼️ ${escapeHtml(x.name)} <span class="dim">${x.width || '?'}×${x.height || '?'} · ${Math.max(1, Math.round((x.bytes || 0) / 1024))} КБ</span></div>`;
    return `<div class="file">📄 ${escapeHtml(x.name)}</div>`;
  }).join('') || '<div class="file">не загружены</div>';
  renderAttachInfo();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function addFiles() {
  const paths = await window.tutorAPI.pickFiles();
  if (!paths.length) return;
  const picked = await window.tutorAPI.readFiles(paths);
  const fresh = picked.filter((x) => !(materials.some((m) => m.name === x.name) && x.type !== 'unsupported'));
  const dup = picked.length - fresh.length;
  materials = materials.concat(fresh);
  renderFiles();
  if (fresh.some((x) => x.type === 'image')) refreshVisionStatus();
  if (dup) addMsg('assistant', `Не добавила ${dup} файл(ов) — такие уже загружены.`);
  if (fresh.some((x) => x.type === 'unsupported')) {
    addMsg('assistant', 'Некоторые файлы не прочитаны — они перечислены в панели «Материалы» с причиной. Понимаются только PDF, DOCX, TXT, MD, PNG, JPG и WEBP.');
  }
}

async function refreshStatus() {
  const box = byId('llmstatus');
  const api = byId('api').value.replace(/\/$/, '');
  const st = await window.tutorAPI.llmPing(api);
  box.className = 'llmstatus ' + (st.ok ? 'ok' : 'bad');
  box.textContent = st.ok ? `модель доступна · ${byId('model').value}` : `нет связи с ${api} — проверь, запущен ли сервер (${st.error || st.status})`;
  const tts = await window.tutorAPI.ttsHealth();
  const tbox = byId('ttsstatus');
  tbox.className = 'llmstatus ' + (tts.up ? 'ok' : 'bad');
  tbox.textContent = tts.up ? `озвучка Silero на ${tts.url}` : 'озвучка выключена — сервер не отвечает';
}

function openDrawer(pane) {
  const drawer = byId('drawer');
  if (pane) showPane(pane);
  drawer.classList.toggle('open');
  if (drawer.classList.contains('open')) window.tutorAvatar && window.tutorAvatar.relayout && window.tutorAvatar.relayout();
}

function showPane(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
}

function fillModal() {
  byId('p_course').value = String(profile.course || 3);
  byId('p_exam').value = profile.examDate || '';
  const goal = profile.goal || '';
  const opt = [...byId('p_goalkind').options].find((o) => goal.startsWith(o.value));
  if (opt) byId('p_goalkind').value = opt.value;
  byId('p_weak').value = (profile.weak || []).map((w) => (w.topic || w)).join(', ');
  byId('p_known').value = (profile.mastered || []).map((m) => (m.topic || m)).join(', ');
  byId('p_materials').value = profile.materials || '';
  byId('p_conv').value = profile.conventions || '';
}

function openModal() {
  fillModal();
  byId('modal').hidden = false;
  byId('p_course').focus();
}

async function saveModal(startLesson) {
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).map((topic) => ({ topic }));
  const examDate = byId('p_exam').value;
  const patch = {
    course: byId('p_course').value,
    level: `${byId('p_course').value} курс, ${byId('p_hours').value} ч/нед подготовки`,
    goal: `${byId('p_goalkind').value}${examDate ? ` (экзамен ${examDate})` : ''}`,
    examDate,
    weeklyHours: byId('p_hours').value,
    materials: byId('p_materials').value,
    conventions: byId('p_conv').value,
    weak: split(byId('p_weak').value),
    mastered: split(byId('p_known').value)
  };
  profile = await window.tutorAPI.profileSet(patch);
  renderProfile();
  byId('modal').hidden = true;
  if (startLesson) {
    byId('mode').value = 'diagnose';
    byId('mode').onchange();
    byId('prompt').value = 'Начинаем занятие.';
    send();
  } else {
    byId('prompt').focus();
  }
}

async function boot() {
  character = (await window.tutorAPI.characterGet()) || null;
  profile = (await window.tutorAPI.profileGet()) || {};
  renderProfile();

  const saved = await window.tutorAPI.loadSession();
  if (saved && Array.isArray(saved.messages)) {
    session = saved;
    for (const m of session.messages) addMsg(m.role, m.role === 'user' ? m.content : stripTags(m.content));
    const last = [...session.messages].reverse().find((m) => m.role === 'assistant');
    if (last) {
      boardParse(last.content);
      if (window.tutorAvatar) avatarParse(last.content);
    }
    if (byId('hint')) byId('hint').hidden = true;
  }

  const llm = await window.tutorAPI.llmSettings();
  if (llm) {
    if (llm.api) byId('api').value = llm.api;
    if (llm.model) byId('model').value = llm.model;
    if (llm.key) byId('key').value = llm.key;
  }
  visionOverride = ((await window.tutorAPI.visionGet()) || {}).overrides || {};
  ['api', 'model', 'key'].forEach((id) => byId(id).addEventListener('change', () => {
    window.tutorAPI.saveLlmSettings({ api: byId('api').value, model: byId('model').value, key: byId('key').value });
    vision.status = 'unknown';
    refreshStatus();
    refreshVisionStatus();
  }));
  byId('visioncheck').onclick = async () => {
    const box = byId('visionstatus');
    box.className = 'llmstatus';
    box.textContent = 'проверяю зрение модели…';
    delete visionCache[byId('model').value];
    await refreshVisionStatus();
  };
  byId('visionforce').onchange = async () => {
    const model = byId('model').value;
    if (byId('visionforce').checked) visionOverride[model] = 'vision';
    else delete visionOverride[model];
    await window.tutorAPI.visionSet({ overrides: visionOverride });
    vision.status = await visionStatus();
    renderAttachInfo();
    const box = byId('visionstatus');
    box.className = 'llmstatus ' + (vision.status === 'vision' ? 'ok' : '');
    box.textContent = `${model}: ${visionText(vision.status)}${byId('visionforce').checked ? ' (вручную)' : ''}`;
  };
  byId('tts').addEventListener('change', async () => {
    if (byId('tts').checked) await window.tutorAPI.ttsStart();
    if (window.tutorAvatar) window.tutorAvatar.stopSpeech();
    refreshStatus();
  });

  byId('add').onclick = addFiles;
  byId('send').onclick = () => send();
  byId('submit').onclick = () => {
    if (!byId('prompt').value.trim()) {
      byId('prompt').focus();
      byId('prompt').placeholder = 'Вставь сюда своё решение по шагам — Асуна проверит каждую строку';
      return;
    }
    byId('mode').value = 'check';
    byId('mode').onchange();
    send();
  };
  byId('startquiz').onclick = () => {
    byId('mode').value = 'quiz';
    byId('mode').onchange();
    byId('prompt').value = 'Начнём тест.';
    byId('drawer').classList.remove('open');
    send();
  };
  byId('mode').onchange = () => {
    const m = byId('mode').value;
    byId('quizbox').hidden = m !== 'quiz';
    byId('modetip').textContent = MODE_DIRECTIVE[m].split('.')[0].replace('РЕЖИМ: ', '');
    if (m === 'check') byId('prompt').placeholder = 'Вставь своё решение по шагам';
    else if (m === 'quiz') byId('prompt').placeholder = 'Твой ответ на задание';
    else byId('prompt').placeholder = 'Например: подготовь меня по уравнениям теплопроводности к экзамену';
  };
  byId('clear').onclick = () => { byId('board').innerHTML = '<div class="hint">Тетрадь очищена.</div>'; };
  byId('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
    else if (e.key === 'Enter' && e.shiftKey) send(true);
  });

  byId('newsession').onclick = async () => {
    if (!confirm('Начать новую сессию? История уйдёт в архив, профиль и график повторения сохранятся.')) return;
    await window.tutorAPI.sessionArchive();
    session = { messages: [], board: [] };
    materials = [];
    renderFiles();
    byId('messages').innerHTML = '';
    byId('hint').hidden = false;
    byId('board').innerHTML = '<div class="hint">Здесь Асуна будет вести конспект, выводить формулы и пошаговые решения.</div>';
    byId('prompt').focus();
  };
  byId('wipe').onclick = async () => {
    if (!confirm('Стереть профиль, ошибки и график повторения? Начать с нуля.')) return;
    profile = await window.tutorAPI.profileClear();
    renderProfile();
    openModal();
  };
  byId('profilebtn').onclick = () => openModal();
  byId('profileedit').onclick = () => openModal();
  byId('p_save').onclick = () => saveModal(!profile.goal);
  byId('p_cancel').onclick = () => { byId('modal').hidden = true; byId('prompt').focus(); };
  byId('drawerbtn').onclick = () => openDrawer();
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      showPane(tab.dataset.pane);
      byId('drawer').classList.add('open');
    };
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') byId('drawer').classList.remove('open'); });
  byId('model-picker-side').addEventListener('change', (e) => {
    byId('model-picker').value = e.target.value;
    byId('model-picker').dispatchEvent(new Event('change'));
  });
  byId('model-picker').addEventListener('change', (e) => { byId('model-picker-side').value = e.target.value; });

  byId('mode').onchange();
  if (!byId('tts').checked) byId('tts').checked = true;

  await refreshStatus();
  refreshVisionStatus();
  requestAnimationFrame(scrollChat);
  if (!profile.goal) openModal();
}

document.addEventListener('DOMContentLoaded', boot);

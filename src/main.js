const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

let win;
const DATA = () => path.join(app.getPath('userData'), 'tutor-data');
async function ensureData(){ await fs.mkdir(DATA(), {recursive:true}); }

function createWindow(){
  win = new BrowserWindow({width:1500,height:950,minWidth:1050,minHeight:700,backgroundColor:'#10131a',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.loadFile(path.join(__dirname,'index.html'));
}
app.whenReady().then(async()=>{await ensureData(); createWindow(); ensureTtsServer(); app.on('activate',()=>BrowserWindow.getAllWindows().length===0&&createWindow());});
app.on('window-all-closed',()=>{ stopTtsServer(); if(process.platform!=='darwin') app.quit(); });
app.on('before-quit', stopTtsServer);

ipcMain.handle('pick-files', async()=>{
  const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'Учебные материалы',extensions:['pdf','docx','txt','md','png','jpg','jpeg','webp']},{name:'Все файлы',extensions:['*']}]});
  return r.canceled?[]:r.filePaths;
});

const IMG_MIME={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const MAX_SIDE=1280;
const MAX_BYTES=900*1024;
// Фото с телефона — это 4–8 МБ. Локальные VLM и especially локальные
// OpenAI-шлюзы такое не едят: проверено, что прокси отдаёт 502/504 уже на
// картинке в несколько сотен килобайт. Поэтому жмём всё в JPEG, режем по
// большей стороне и уменьшаем ещё раз, если не влезли в лимит.
async function loadImage(p){
  const ext=path.extname(p).toLowerCase();
  if(!IMG_MIME[ext]) return {type:'unsupported',name:path.basename(p),text:'',note:`формат ${ext||'без расширения'} не читается. Конвертируй в PNG или JPEG (например, heif-convert / magick).`};
  const raw=await fs.readFile(p);
  const img=nativeImage.createFromBuffer(raw);
  const size=img.getSize();
  const encode=(w,q)=>img.resize({width:w,quality:'good'}).toJPEG(q);
  let out=raw, mime=IMG_MIME[ext];
  if(size.width&&size.height){
    if(Math.max(size.width,size.height)>MAX_SIDE||raw.length>MAX_BYTES){
      out=encode(Math.min(MAX_SIDE,Math.max(size.width,size.height)),82);
      mime='image/jpeg';
      for(const q of [70,60,50]){
        if(out.length<=MAX_BYTES) break;
        out=encode(Math.min(MAX_SIDE,Math.max(size.width,size.height)),q);
      }
      if(out.length>MAX_BYTES) out=encode(768,50);
    }
  }
  return {type:'image',name:path.basename(p),data:out.toString('base64'),mime,text:'',width:size.width,height:size.height,bytes:out.length};
}

async function readDoc(p){
  const ext=path.extname(p).toLowerCase();
  if(ext==='.txt'||ext==='.md') return {type:'text',name:path.basename(p),text:await fs.readFile(p,'utf8')};
  if(ext==='.pdf'){const b=await fs.readFile(p); const d=await pdfParse(b); let out={type:'text',name:path.basename(p),text:d.text||''}; if(out.text.trim().length<250){ try{ const tmp=path.join(DATA(),'pdf-pages'); await fs.mkdir(tmp,{recursive:true}); const prefix=path.join(tmp, path.basename(p).replace(/[^a-z0-9_-]/gi,'_')); await execFileP('pdftoppm',['-png','-f','1','-singlefile','-r','150',p,prefix]); const img=await loadImage(prefix+'.png'); if(img.type==='image'){ out={type:'image',name:path.basename(p)+' (первая страница)',data:img.data,mime:img.mime,text:out.text}; } }catch{} } return out;}
  if(ext==='.docx'){const d=await mammoth.extractRawText({path:p}); return {type:'text',name:path.basename(p),text:d.value};}
  if(IMG_MIME[ext]) return loadImage(p);
  return {type:'unsupported',name:path.basename(p),text:'',note:`формат ${ext||'без расширения'} не поддерживается. Понимаются: PDF, DOCX, TXT, MD, PNG, JPG, WEBP.`};
}
ipcMain.handle('read-files', async(_,paths)=>Promise.all(paths.map(readDoc)));

const FALLBACK_LLM={api:'http://127.0.0.1:11434/v1',model:'qwen2.5:32b',key:''};
function normalizeBase(u){
  let s=String(u||'').trim().replace(/\/+$/,'');
  s=s.replace(/\/chat\/completions$/i,'').replace(/\/v1$/i,'/v1');
  return s||'';
}
async function readJson(p){ try{ return JSON.parse(await fs.readFile(p,'utf8')); }catch{ return null; } }
async function asunaLlm(){
  const home=app.getPath('home');
  const names=await fs.readdir(path.join(home,'.config')).catch(()=>[]);
  for(const n of names){
    if(!/asuna|vectorheart/i.test(n)) continue;
    const s=await readJson(path.join(home,'.config',n,'vectorheart-settings.json'));
    if(s&&s.llm&&s.llm.baseUrl) return {api:normalizeBase(s.llm.baseUrl),model:s.llm.model||FALLBACK_LLM.model,key:s.llm.apiKey||''};
  }
  return null;
}
ipcMain.handle('llm-settings', async()=>{
  const mine=await readJson(path.join(DATA(),'llm.json'));
  const theirs=await asunaLlm();
  const src=mine||theirs;
  return src?{api:normalizeBase(src.api)||FALLBACK_LLM.api,model:src.model||FALLBACK_LLM.model,key:src.key||'',source:mine?'tutor':'asuna'}:{...FALLBACK_LLM,source:'default'};
});
ipcMain.handle('save-llm-settings', async(_,s)=>{ await fs.writeFile(path.join(DATA(),'llm.json'),JSON.stringify({api:normalizeBase(s.api),model:s.model,key:s.key},null,2)); return true; });
ipcMain.handle('llm-ping', async(_,api)=>{
  try{ const r=await fetch(normalizeBase(api)+'/models',{signal:AbortSignal.timeout(2500)}); return {ok:r.ok,status:r.status}; }catch(e){ return {ok:false,error:String(e.message||e)}; }
});
ipcMain.handle('llm-models', async(_,api)=>{
  try{
    const r=await fetch(normalizeBase(api)+'/models',{signal:AbortSignal.timeout(4000)});
    if(!r.ok) return [];
    const d=await r.json();
    const list=Array.isArray(d)?d:(Array.isArray(d.data)?d.data:[]);
    return list.map(m=>({id:String(m.id||''),vision:!!(m.capabilities&&(m.capabilities.vision===true||m.capabilities.image===true))})).filter(m=>m.id);
  }catch{ return []; }
});
ipcMain.handle('vision:get', async()=>readJson(path.join(DATA(),'vision.json')));
ipcMain.handle('vision:set', async(_,v)=>{
  const next={...((await readJson(path.join(DATA(),'vision.json')))||{}),...v};
  await fs.writeFile(path.join(DATA(),'vision.json'),JSON.stringify(next,null,2));
  return next;
});
ipcMain.handle('save-session', async(_,session)=>{const p=path.join(DATA(),'last-session.json'); await fs.writeFile(p,JSON.stringify(session,null,2)); return p;});

// ───────────────────────── Профиль студента (память между сессиями) ─────────────────────────
const EMPTY_PROFILE={goal:'',level:'',conventions:'',topics:[],weak:[],mastered:[],mistakes:[],review:[],next:''};
function mergeProfile(a,b){
  if(!b||typeof b!=='object') return a;
  const out={...a};
  for(const k of Object.keys(a)){
    const v=b[k];
    if(v===undefined||v===null) continue;
    if(Array.isArray(a[k])) out[k]=Array.isArray(v)?v.slice(0,60):a[k];
    else if(typeof a[k]==='string') out[k]=String(v).slice(0,1500);
    else out[k]=v;
  }
  return out;
}
ipcMain.handle('profile:get', async()=>mergeProfile(EMPTY_PROFILE,await readJson(path.join(DATA(),'profile.json'))));
ipcMain.handle('profile:set', async(_,p)=>{
  const next=mergeProfile(mergeProfile(EMPTY_PROFILE,await readJson(path.join(DATA(),'profile.json'))),p);
  await fs.writeFile(path.join(DATA(),'profile.json'),JSON.stringify(next,null,2));
  return next;
});
ipcMain.handle('profile:clear', async()=>{ await fs.writeFile(path.join(DATA(),'profile.json'),JSON.stringify(EMPTY_PROFILE,null,2)); return EMPTY_PROFILE; });
ipcMain.handle('session:clear', async()=>{ await fs.writeFile(path.join(DATA(),'last-session.json'),JSON.stringify({messages:[],board:[]},null,2)); return true; });
ipcMain.handle('session:archive', async()=>{
  const dir=path.join(DATA(),'archive'); await fs.mkdir(dir,{recursive:true});
  const old=await readJson(path.join(DATA(),'last-session.json'));
  const name=path.join(dir,`session-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  await fs.writeFile(name,JSON.stringify(old,null,2));
  await fs.writeFile(path.join(DATA(),'last-session.json'),JSON.stringify({messages:[],board:[]},null,2));
  return name;
});

// ───────────────────────── TTS (Silero, голос baya) — перенесено из Asuna VectorHeart ─────────────────────────
const SERVER_DIR=path.join(__dirname,'..','server');
let ttsProcess=null;
const TTS_URL='http://127.0.0.1:8009';
function ttsHealth(){
  return new Promise(res=>{ const r=http.get(`${TTS_URL}/health`,{timeout:1500},x=>{ res(x.statusCode===200); x.resume(); }); r.on('error',()=>res(false)); r.on('timeout',()=>{r.destroy();res(false);}); });
}
function pickPython(){
  const local=path.join(SERVER_DIR,'venv','bin','python');
  if(fsSync.existsSync(local)) return local;
  const home=app.getPath('home');
  const borrowed=[
    path.join(home,'Downloads','Asuna_Electron_PC-main-node26-fixed-latest','самая новая версия','server','venv','bin','python'),
    path.join(home,'src','hermes_paperclip_agent','server','venv','bin','python')
  ];
  for(const p of borrowed) if(fsSync.existsSync(p)) return p;
  return 'python3';
}
async function ensureTtsServer(){
  if(await ttsHealth()) return true;
  const script=path.join(SERVER_DIR,'tts_server.py');
  if(!fsSync.existsSync(script)) return false;
  try{
    ttsProcess=spawn(pickPython(),[script],{cwd:SERVER_DIR,env:{...process.env,SILERO_SPEAKER:'baya',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},stdio:'pipe'});
    ttsProcess.stdout.on('data',d=>process.stdout.write(`[tts] ${d}`));
    ttsProcess.stderr.on('data',d=>process.stderr.write(`[tts] ${d}`));
    ttsProcess.on('error',e=>{ console.warn('[tts] не запустился:',e.message); ttsProcess=null; });
    ttsProcess.on('exit',()=>{ ttsProcess=null; });
    return true;
  }catch(e){ console.warn('[tts] ошибка запуска:',e.message); return false; }
}
function stopTtsServer(){ if(ttsProcess&&!ttsProcess.killed){ try{ttsProcess.kill();}catch{} } ttsProcess=null; }
ipcMain.handle('tts:health', async()=>({up:await ttsHealth(),url:TTS_URL,local:!!ttsProcess}));
ipcMain.handle('tts:start', async()=>{ await ensureTtsServer(); return ttsHealth(); });
ipcMain.handle('tts:synth', async(_,text,speaker='baya')=>{
  const clean=String(text||'').slice(0,900);
  if(!clean.trim()) return {ok:false,error:'empty'};
  if(!(await ttsHealth()) && !(await ensureTtsServer())) return {ok:false,error:'server down'};
  try{
    const res=await fetch(`${TTS_URL}/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean,speaker})});
    if(!res.ok) return {ok:false,error:`http ${res.status}: ${(await res.text()).slice(0,200)}`};
    const buf=Buffer.from(await res.arrayBuffer());
    return {ok:true,bytes:buf,rate:48000};
  }catch(e){ return {ok:false,error:String(e.message||e)}; }
});

// ───────────────────────── Live2D-аватар (перенесено из Asuna VectorHeart) ─────────────────────────
// Модели и движок лежат в resources/ в той же раскладке, что в Асуне:
// resources/libs/{pixi,live2d,cubism2}.min.js и resources/models/<id>/<id>.model.json
const RES = path.join(__dirname, '..', 'resources');
const MODELS_DIR = path.join(RES, 'models');

async function listModels(){
  const m = await readJson(path.join(RES,'models_manifest.json'));
  if (Array.isArray(m) && m.length) return m.filter(x=>x&&x.id).map(x=>({id:x.id,expressions:x.expressions||0,motions:x.motions||0}));
  const names = await fs.readdir(MODELS_DIR).catch(()=>[]);
  return names.filter(n=>n!=='_capability_audit.json' && !n.endsWith('.txt'))
    .filter(n=>fs.existsSync(path.join(MODELS_DIR,n,`${n}.model.json`)))
    .map(id=>({id,expressions:0,motions:0}));
}
ipcMain.handle('avatar:list', async()=>listModels());
ipcMain.handle('avatar:manifest', async(_,id)=>{
  const safe=String(id||'').replace(/[^a-z0-9_-]/gi,'');
  if (!safe) return null;
  const j = await readJson(path.join(MODELS_DIR,safe,`${safe}.model.json`));
  if (!j) return null;
  return {
    expressions:(j.expressions||[]).map((e,i)=>({name:e.name||'',index:i})),
    motions:Object.fromEntries(Object.entries(j.motions||{}).map(([g,arr])=>[g,(arr||[]).map((m,i)=>({file:m.file||'',index:i}))]))
  };
});
ipcMain.handle('avatar:get', async()=>{
  const s=await readJson(path.join(DATA(),'avatar.json'));
  const models=await listModels();
  const id=s&&s.id&&models.find(m=>m.id===s.id)?s.id:(models[0]&&models[0].id)||null;
  return {id,visible:s?!!s.visible:true,scale:s&&s.scale?s.scale:1};
});
ipcMain.handle('avatar:set', async(_,v)=>{
  const cur=(await readJson(path.join(DATA(),'avatar.json')))||{visible:true,scale:1};
  const next={...cur,...v};
  await fs.writeFile(path.join(DATA(),'avatar.json'),JSON.stringify(next,null,2));
  return next;
});
ipcMain.handle('load-session', async()=>{try{return JSON.parse(await fs.readFile(path.join(DATA(),'last-session.json'),'utf8'));}catch{return null;}});
ipcMain.handle('character:get', async()=>readJson(path.join(__dirname,'..','character.json')));
ipcMain.handle('open-external',(_,url)=>shell.openExternal(url));

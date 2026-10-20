// Stub DOM and in-memory storage to exercise the side panel flows. Not a browser test. Run: node tests/panel-smoke.js
const vm = require('vm'), fs = require('fs'), root = require('path').join(__dirname, '..') + '/';
class N { constructor(t){this.tag=t;this.children=[];this.attrs={};this.listeners={};this.className='';this.value='';this.nodeType=1;}
  setAttribute(k,v){this.attrs[k]=v;} append(...k){this.children.push(...k);} replaceChildren(...k){this.children=k;}
  addEventListener(e,f){(this.listeners[e]=this.listeners[e]||[]).push(f);}
  click(){return Promise.all((this.listeners.click||[]).map(f=>f({target:this})));}
  get text(){return this.children.map(c=>c.text!==undefined?c.text:'').join(' ');}
  find(pred,out=[]){ if(pred(this)) out.push(this); this.children.forEach(c=>c.find&&c.find(pred,out)); return out; } }
const appNode = new N('div'); const listeners = []; const inserted = [];
const sandbox = { console, setTimeout, Blob: class{}, URL:Object.assign(function(u){return new (require('url').URL)(u);},{createObjectURL:()=>'x',revokeObjectURL(){}}),
  document:{ getElementById:()=>appNode, createElement:t=>new N(t), createElementNS:(ns,t)=>new N(t), createTextNode:s=>({nodeType:3,text:String(s)}) },
  navigator:{clipboard:{writeText:async()=>{}}}, location:{pathname:'/chat/x'} };
sandbox.chrome = { runtime:{onMessage:{addListener:f=>listeners.push(f)}, sendMessage:async()=>{}},
  tabs:{query:async()=>[{id:1,url:'https://claude.ai/chat/x'}],onActivated:{addListener(){}},onUpdated:{addListener(){}},sendMessage:async(id,m)=>{inserted.push(m.text);return{ok:true};}},
  storage:{session:{get:async()=>({}),set:async()=>{}}} };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
const run = (code,f) => new vm.Script(code,{filename:f}).runInContext(ctx);
const runFile = f => run(fs.readFileSync(root+f,'utf8'), f);
['lib/brand.js','lib/parse.js','lib/prompts.js','lib/csv.js'].forEach(runFile);
run(`const MFDB = (() => { const s = {packs:{},marks:{},meta:{}}; const kp = {packs:'id',marks:'key',meta:'k'};
  return { getAll: async st => Object.values(s[st]), get: async (st,k) => s[st][k], put: async (st,v) => { s[st][v[kp[st]]] = JSON.parse(JSON.stringify(v)); },
    del: async (st,k) => { delete s[st][k]; }, setMeta: async (k,v) => { s.meta[k] = {k,v}; }, getMeta: async k => s.meta[k] ? s.meta[k].v : undefined,
    saveMark: async (pid,m) => { const key = pid+':'+m.student; s.marks[key] = Object.assign({}, m, {key,packId:pid,decision:'pending',overridden:false,modelScores:m.scores,modelComment:m.comment||'',capturedAt:Date.now(),history:[]}); return {status:'new'}; } }; })();`, 'stub');
runFile('sidepanel/app.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => appNode.text.replace(/\s+/g,' ');
const btn = label => appNode.find(n => n.tag==='button' && n.text.trim()===label)[0];
const ok = (c,m) => { if(!c){ console.error('FAIL', m, '\n', text().slice(0,400)); process.exit(1);} console.log('ok  '+m); };
const db = vm.runInContext('MFDB', ctx);

(async () => {
  await sleep(50);
  ok(/Import rubric from files/.test(text()) && /Build a pack by hand/.test(text()), 'first run offers import and manual build');

  await btn('Import rubric from files').click(); await sleep(20);
  ok(inserted.length===1 && inserted[0].includes('labelled mark-pack'), 'import inserts the rubric request into the composer');
  ok(/Waiting for the reply/.test(text()), 'import view waits for the reply');

  const imp = vm.runInContext(`MFParse.extract('{"name":"DB Task","task":"Design a DB","statedTotal":25,"criteria":[{"id":"C1","name":"Schema","max":10,"descriptor":"a"},{"id":"C2","name":"Queries","max":10,"descriptor":"b"}]}', null).imports[0]`, ctx);
  await db.setMeta('pendingImport', { at: 1, data: JSON.parse(JSON.stringify(imp)) });
  listeners.forEach(f => f({ type:'DB_CHANGED' })); await sleep(50);
  ok(/Criteria add up to 20 but the document states 25/.test(text()), 'import review shows the total mismatch');
  await btn('Save as new pack').click(); await sleep(30);
  ok(/Tick the box/.test(text()) && (await db.getAll('packs')).length===0, 'save is blocked until the mismatch is confirmed');
  appNode.find(n => n.tag==='input' && n.attrs.type==='checkbox')[0].listeners.change[0]({target:{checked:true}});
  await btn('Save as new pack').click(); await sleep(60);
  const packs = await db.getAll('packs');
  ok(packs.length===1 && packs[0].rubric.length===2 && packs[0].name==='DB Task', 'confirmed import saves a pack with 2 criteria');
  ok((await db.getMeta('pendingImport'))===null, 'pending import cleared after save');

  const pid = packs[0].id;
  await db.saveMark(pid, vm.runInContext(`MFParse.extract('{"student":"S08","scores":{"C1":4,"C2":3},"flags":["between anchors"],"confidence":"low"}', ${JSON.stringify(packs[0].rubric)}).marks[0]`, ctx));
  listeners.forEach(f => f({ type:'DB_CHANGED' })); await sleep(50);
  appNode.find(n => n.tag==='button' && n.text.trim()==='Markbook')[0].click(); await sleep(20);
  ok(/S08/.test(text()) && /1 marked/.test(text()), 'markbook lists the captured mark');
  appNode.find(n => n.tag==='button' && n.attrs['aria-label']==='Open S08')[0].click(); await sleep(20);
  ok(/Check this one/.test(text()), 'flagged mark shows the review notice');

  appNode.find(n => n.tag==='button' && n.text.trim()==='Pack')[0].click(); await sleep(20);
  await btn('Import').click(); await sleep(20);
  ok(/Import anchors from marked scripts/.test(text()) && inserted[inserted.length-1].includes('labelled mark-handover'), 'anchors import inserts its request and shows its steps');
  await db.setMeta('pendingHandover', { packId: pid, at: 2, data: { pack: pid, rulings: [], anchors: [{student:'S06',score:17,note:'strong'}], notes: [] } });
  listeners.forEach(f => f({ type:'DB_CHANGED' })); await sleep(50);
  ok(/S06 \(17\): strong/.test(text()), 'anchor review shows student and score');
  await btn('Save selected and insert new-chat prompt').click(); await sleep(60);
  const p2 = (await db.getAll('packs'))[0];
  ok(p2.anchors.length===1 && p2.anchors[0].score===17 && p2.version===2, 'saved anchor keeps its score and bumps the version');
  console.log('\nsmoke passed');
})().catch(e => { console.error('ERROR', e); process.exit(1); });

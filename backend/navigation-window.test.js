import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNavigationBackup } from './navigation/schema.js';

// Exercise the same frontend module without copying browser platform files into source.
const source = (await readFile(new URL('../frontend/lib/navigation-backup.js', import.meta.url), 'utf8'))
  .replace("'../platform/navigation/codec.js'", JSON.stringify(new URL('./navigation/codec.js', import.meta.url).href));
const { createNavigationBackupController, NAVIGATION_RESTORE_CHANNEL: channel } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const restoreSource = (await readFile(new URL('../frontend/restore.js', import.meta.url), 'utf8'))
  .replace("'./platform/navigation/codec.js'", JSON.stringify(new URL('./navigation/codec.js', import.meta.url).href));
const { extractAutofillPacketFromDocument, parseRestoreSessionTokenFromHash, initRestorePage } = await import(`data:text/javascript;base64,${Buffer.from(restoreSource).toString('base64')}`);
const pages = ['all','ai','design','dev','media'].map((id,order) => ({id,title:id,icon:'sparkles',isSystem:true,order}));
const backup = () => createNavigationBackup({ sites: [], pages, desktop: { schemaVersion:2,pages,placements:[],folders:[] }, layout:[] });

function harness() {
  let now = 0, calls = 0, drained = false; const replies = [], listeners = new Map(), locks = [];
  const timeouts=new Map(), intervals=new Map(); let timerId=0;
  const child = { closed: false, postMessage: (message, origin) => replies.push({message,origin}) };
  const win = { location: { origin:'https://launchdeck.example', href:'https://launchdeck.example/' },
    open: () => child, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const controller = createNavigationBackupController({ windowRef:win, now:()=>now,
    setTimeoutFn:(fn,delay)=>{const id=++timerId;timeouts.set(id,{fn,delay});return id;},
    clearTimeoutFn:id=>timeouts.delete(id),
    setIntervalFn:(fn,delay)=>{const id=++timerId;intervals.set(id,{fn,delay});return id;},
    clearIntervalFn:id=>intervals.delete(id),
    setEditLock: value => locks.push(value), drainPendingBeforeImport: async () => { drained=true; },
    fetchRevisionsBeforeImport: async () => { assert.equal(drained,true); return {portalRevision:1,widgetRevision:2}; },
    postAtomicNavigationImport: async input => { calls++; assert.equal(input.widgetRevision,2); return {success:true,restoreId:'new'}; },
    applyImportedBrowserDataAndReload: async () => {},
  });
  const start = () => { const session=controller.openRestoreWindow(); return {source:child,origin:win.location.origin,data:{channel,token:session.token,type:'apply',backup:backup()}}; };
  return {controller,child,listeners,replies,locks,start,timeouts,intervals, setTime: v=>{now=v;}, get calls(){return calls;} };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('restore messages require the opened source, exact origin, channel and random token; replays do not apply', async () => {
  const h=harness(), event=h.start(), listener=h.listeners.get('message');
  assert.match(event.data.token,/^[a-f0-9]{48}$/);
  for(const wrong of [ {...event,source:{}}, {...event,origin:'https://evil.example'},
    {...event,origin:'null'}, {...event,data:{...event.data,token:'wrong'}}, {...event,data:{...event.data,channel:'wrong'}} ]) listener(wrong);
  await settle(); assert.equal(h.calls,0);
  listener(event); listener(event); await settle();
  assert.equal(h.calls,1); assert.equal(h.listeners.has('message'),false);
  assert.deepEqual(h.locks,[true]); assert.equal(h.replies[0].origin,event.origin);
});

test('expired, cancelled and invalid backups never reach atomic import', async () => {
  for(const kind of ['expired','cancel','invalid']) {
    const h=harness(), event=h.start(), listener=h.listeners.get('message');
    if(kind==='expired') h.setTime(10*60*1000+1);
    if(kind==='cancel') event.data.type='cancel';
    if(kind==='invalid') event.data.backup.note='private';
    listener(event); await settle(); assert.equal(h.calls,0);
    listener({...event,data:{...event.data,type:'apply',backup:backup()}}); await settle(); assert.equal(h.calls,0);
  }
});

test('closed and expired restore windows release listeners and timers without receiving a message', () => {
  for(const mode of ['closed','expired','destroy']) {
    const h=harness(); h.start();
    assert.equal(h.timeouts.size,1); assert.equal(h.intervals.size,1);
    if(mode==='closed') {h.child.closed=true; [...h.intervals.values()][0].fn();}
    if(mode==='expired') {h.setTime(600001); [...h.timeouts.values()][0].fn();}
    if(mode==='destroy') h.controller.destroy();
    assert.equal(h.controller.getActiveSession(),null);
    assert.equal(h.listeners.has('message'),false);
    assert.equal(h.timeouts.size,0); assert.equal(h.intervals.size,0);
    assert.equal(h.calls,0);
  }
});

test('a save failure releases the edit lock and never invokes import or cache clearing', async () => {
  const locks=[];
  const controller=createNavigationBackupController({setEditLock: v=>locks.push(v),
    drainPendingBeforeImport: async()=>{throw Error('offline');},
    fetchRevisionsBeforeImport: ()=>assert.fail('must not import unsaved data'),
    postAtomicNavigationImport: ()=>assert.fail('must not write'),
    applyImportedBrowserDataAndReload: ()=>assert.fail('must not clear cache'),
  });
  const result=await controller.applyNavigationBackup(backup());
  assert.equal(result.ok,false); assert.deepEqual(locks,[true,false]);
});

test('restore form reads only the declared chunk count and rejects missing or oversized segment counts', () => {
  const fields = new Map([['launchdeck_nav_manifest', {value: JSON.stringify({chunks:1})}],
    ['launchdeck_nav_chunk_0',{value:'data'}], ['launchdeck_nav_chunk_1',{value:'stale-other-backup'}]]);
  const doc = {getElementById: id => fields.get(id)};
  assert.deepEqual(extractAutofillPacketFromDocument(doc).chunks,['data']);
  assert.equal(fields.get('launchdeck_nav_chunk_1').value,'');
  for(const chunks of [0,17,-1,'1',null]) {
    fields.get('launchdeck_nav_manifest').value=JSON.stringify({chunks});
    assert.throws(()=>extractAutofillPacketFromDocument(doc));
  }
  fields.get('launchdeck_nav_manifest').value=JSON.stringify({chunks:2});
  assert.throws(()=>extractAutofillPacketFromDocument(doc),/分段不足/);
  assert.equal(parseRestoreSessionTokenFromHash('#token='+'a'.repeat(48)),'a'.repeat(48));
  for(const hash of ['#token=guess','#token='+'a'.repeat(48)+'&origin=https://evil.example','#backup=secret']) assert.equal(parseRestoreSessionTokenFromHash(hash),null);
});

test('homepage search and standalone restore never share a credential form or application bootstrap', async () => {
  const homepage=await readFile(new URL('../frontend/index.html',import.meta.url),'utf8');
  const restore=await readFile(new URL('../frontend/restore.html',import.meta.url),'utf8');
  assert.match(homepage,/<input\s+type="search"\s+id="spotlightInput"/);
  assert.doesNotMatch(homepage,/launchdeck_nav_(?:manifest|chunk_)|autocomplete="current-password"/);
  assert.doesNotMatch(restore,/(?:src="(?:app|backend-client)\.js"|spotlightInput)/);
  assert.equal((restore.match(/name="launchdeck_nav_chunk_\d+"/g)||[]).length,16);
});

test('file input uses the shared decoder, bounds file size before reading and never auto-applies', async () => {
  function element() { const events=new Map(); return {events,value:'',dataset:{},disabled:false,hidden:false,addEventListener:(name,fn)=>events.set(name,fn)}; }
  const input=element(), status=element(), confirm=element(), preview=element(), text=element();
  const nodes=new Map([['restoreBackupFileInput',input],['restoreStatusText',status],['confirmApplyRestoreBtn',confirm],['restorePreviewSection',preview],['restoreBackupTextInput',text]]);
  const doc={getElementById: id=>nodes.get(id)};
  const win={location:{protocol:'https:',origin:'https://launchdeck.example',hash:''},opener:null,addEventListener(){}};
  const page=initRestorePage({documentRef:doc,windowRef:win});
  const fixture=backup(), json=JSON.stringify(fixture);
  input.files=[{size:new TextEncoder().encode(json).length,text:async()=>json}];
  await input.events.get('change')();
  assert.deepEqual(page.getValidatedBackup(),fixture); assert.equal(confirm.disabled,true);
  assert.match(status.textContent,/校验通过/); assert.equal(preview.hidden,false);
  let reads=0;
  input.files=[{size:2*1024*1024+1,text:async()=>{reads++;return json;}}];
  await input.events.get('change')(); assert.equal(reads,0); assert.equal(page.getValidatedBackup(),null);
  assert.match(status.textContent,/不能超过/);
  input.files=[{size:10,text:async()=>'{broken'}];
  await input.events.get('change')(); assert.equal(page.getValidatedBackup(),null); assert.equal(preview.hidden,true);
});

test('a failed apply result consumes the child session instead of offering a dead retry button', async () => {
  function element() {const events=new Map();return {events,value:'',dataset:{},hidden:false,disabled:false,addEventListener:(name,fn)=>events.set(name,fn)};}
  const input=element(),confirm=element(),status=element();
  const nodes=new Map([['restoreBackupFileInput',input],['confirmApplyRestoreBtn',confirm],['restoreStatusText',status]]);
  const events=new Map(),sent=[],opener={closed:false,postMessage:(message,origin)=>sent.push({message,origin})};
  const win={location:{protocol:'https:',origin:'https://launchdeck.example',hash:'#token='+'a'.repeat(48)},opener,addEventListener:(name,fn)=>events.set(name,fn)};
  const page=initRestorePage({documentRef:{getElementById:id=>nodes.get(id)},windowRef:win});
  const json=JSON.stringify(backup());input.files=[{size:json.length,text:async()=>json}];
  await input.events.get('change')(); assert.equal(confirm.disabled,false);
  confirm.events.get('click')();assert.equal(sent.length,1);
  events.get('message')({source:opener,origin:win.location.origin,data:{channel,token:'a'.repeat(48),type:'apply-result',ok:false,message:'offline'}});
  assert.equal(confirm.disabled,true);assert.equal(page.canPostToOpener(),false);
  assert.match(status.textContent,/重新打开/);
});

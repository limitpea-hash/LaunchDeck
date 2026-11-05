import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createApp } from './app.js';
import { defaultWidgetState, validateWidgetPatch, validateWidgetDocument } from './features/widgets.js';
import { createFeatureStore } from './features/store.js';
import { createLocalDocuments } from './extension/runtime/documents.js';

function folderState() {
  const state = defaultWidgetState();
  state.desktop = { schemaVersion: 2,
    pages: ['all','ai','design','dev','media'].map((id,order)=>({id,title:id,icon:'folder',isSystem:true,order})),
    placements: [
      {kind:'folder',id:'folder_tools',pageId:'all',order:0},
      ...state.layout.map((w,i)=>({kind:'widget',id:w.id,pageId:'all',order:i+1})),
      {kind:'site',id:'first',pageId:'ai',order:0},
    ],
    folders: [{id:'folder_tools',title:'工具',siteIds:['first','other_device_site']}],
  };
  return state;
}
function legacyDesktop(state) {
  return {schemaVersion:1,pages:state.desktop.pages,placements:state.desktop.placements.filter(p=>p.kind!=='folder')};
}

test('folder layout accepts site mirrors on other pages, unresolved members, old layouts and empty v2 folders', () => {
  const state=folderState(); validateWidgetDocument(state);
  validateWidgetPatch({desktop:state.desktop});
  validateWidgetDocument({...state,desktop:legacyDesktop(state)});
  validateWidgetDocument({...state,desktop:{...legacyDesktop(state),schemaVersion:2,folders:[]}});
});

test('folder validation rejects duplicate positions/members, missing references, nested folders and executable fields', () => {
  const mutations=[
    s=>{delete s.desktop.folders;},
    s=>{s.desktop.folders[0].siteIds=['first'];},
    s=>{s.desktop.folders[0].siteIds=['first','first'];},
    s=>{s.desktop.folders[0].siteIds.push({kind:'widget',id:'calendar'});},
    s=>{s.desktop.folders[0].siteIds.push('https://evil.test/');},
    s=>{s.desktop.folders[0].siteIds.push('folder_tools');},
    s=>{s.desktop.folders[0].title=' 工具 ';},
    s=>{s.desktop.folders[0].title='工具\n';},
    s=>{s.desktop.folders[0].title='x'.repeat(61);},
    s=>{s.desktop.folders[0].html='<script>bad()</script>';},
    s=>{s.desktop.folders[0].siteIds=Array.from({length:101},(_,i)=>`site_${i}`);},
    s=>{s.desktop.folders.push({...s.desktop.folders[0]});},
    s=>{s.desktop.placements.push({kind:'folder',id:'folder_tools',pageId:'dev',order:0});},
    s=>{s.desktop.placements[0].id='folder_missing';},
    s=>{s.desktop.placements.shift();},
    s=>{s.desktop.placements.push({kind:'site',id:'first',pageId:'all',order:7});},
    s=>{s.desktop.folders.push({id:'folder_second',title:'第二个',siteIds:['other_device_site','third']});s.desktop.placements.push({kind:'folder',id:'folder_second',pageId:'all',order:7});},
    s=>{s.desktop.folders.push({id:'folder_second',title:'第二个',siteIds:['folder_tools','third']});s.desktop.placements.push({kind:'folder',id:'folder_second',pageId:'all',order:7});},
  ];
  for(const mutate of mutations){const s=folderState();mutate(s);assert.throws(()=>validateWidgetDocument(s),e=>e.status===400);}
});

test('folder member budget includes every member and does not only count top-level icons', () => {
  const s=folderState();
  s.desktop.folders=Array.from({length:50},(_,i)=>({id:`folder_${i}`,title:'工具',siteIds:Array.from({length:100},(_,j)=>`site_${i}_${j}`)}));
  s.desktop.placements=s.desktop.placements.filter(p=>p.kind==='widget');
  s.desktop.placements.push(...s.desktop.folders.map((f,i)=>({kind:'folder',id:f.id,pageId:'all',order:i+10})));
  assert.throws(()=>validateWidgetDocument(s),e=>e.status===400);
});

test('SQLite commits complete folders atomically, preserves them on todos updates and rejects legacy overwrite', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const store=createFeatureStore(db),state=folderState();
    const patch=(value,rev)=>store.patch('widgets',defaultWidgetState,value,`"${rev}"`,validateWidgetPatch,validateWidgetDocument);
    patch({desktop:state.desktop},0);
    const before=store.read('widgets',defaultWidgetState);
    const broken=structuredClone(state.desktop);broken.folders=[];
    assert.throws(()=>patch({desktop:broken},1),e=>e.status===400);
    assert.deepEqual(store.read('widgets',defaultWidgetState),before);
    patch({todos:[]},1);
    assert.deepEqual(store.read('widgets',defaultWidgetState).state.desktop,state.desktop);
    for(const desktop of [legacyDesktop(state),null]){
      assert.throws(()=>patch({desktop},2),e=>e.status===409);
      assert.equal(store.read('widgets',defaultWidgetState).revision,2);
    }
    const renamed=structuredClone(state.desktop);renamed.folders[0].title='新名字';
    patch({desktop:renamed},2);
    assert.throws(()=>patch({desktop:state.desktop},2),e=>e.status===409);
    assert.equal(store.read('widgets',defaultWidgetState).state.desktop.folders[0].title,'新名字');
  } finally {db.close();}
});

test('extension folders survive worker recreation and backup while old tabs cannot downgrade and old backups can import', async () => {
  const data={};const storage={async get(key){return structuredClone({[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));}};
  let docs=createLocalDocuments(storage);const state=folderState();
  await docs.patch('widgets',{desktop:state.desktop},'"0"');
  docs=createLocalDocuments(storage);
  assert.deepEqual((await docs.read('widgets')).state.desktop,state.desktop);
  await assert.rejects(docs.patch('widgets',{desktop:legacyDesktop(state)},'"1"'),e=>e.status===409);
  assert.equal((await docs.read('widgets')).revision,1);
  const backup=await docs.exportData();
  await docs.importData(backup);
  assert.deepEqual((await docs.read('widgets')).state.desktop,state.desktop);
  const broken=structuredClone(backup);broken.widgets.desktop.folders[0].siteIds=['only'];
  const before=await docs.read('widgets');
  await assert.rejects(docs.importData(broken),e=>e.status===400);
  assert.deepEqual(await docs.read('widgets'),before);
  const old=structuredClone(backup);old.widgets.desktop=legacyDesktop(state);
  await docs.importData(old);
  assert.equal((await docs.read('widgets')).state.desktop.schemaVersion,1);
});

test('HTTP keeps the existing widgets contract for folder saves and returns conflict for legacy tabs', async t => {
  const server=createApp({root:process.cwd(),databasePath:':memory:'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const patch=(body,revision)=>fetch(`${base}/api/widgets/state`,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':`"${revision}"`},body:JSON.stringify(body)});
  const state=folderState();
  let response=await patch({desktop:state.desktop},0);
  assert.equal(response.status,200);assert.equal(response.headers.get('etag'),'"1"');
  assert.deepEqual((await response.json()).state.desktop,state.desktop);
  response=await patch({desktop:legacyDesktop(state)},1);
  assert.equal(response.status,409);
  response=await patch({todos:[]},1);assert.equal(response.status,200);
  const after=await(await fetch(`${base}/api/widgets/state`)).json();
  assert.equal(after.revision,2);assert.deepEqual(after.state.desktop,state.desktop);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as folder from '../frontend/lib/desktop-folders.js';
import * as model from '../frontend/lib/desktop-layout.js';
import {normalizeWidgetState} from '../frontend/lib/feature-client.js';
import {defaultWidgetState,validateWidgetDocument} from './features/widgets.js';
const sites=[{id:'first',category:'ai'},{id:'second',category:'ai'},{id:'third',category:'ai'}];
function initial(){return model.migrateLegacyDesktop({sites,layout:defaultWidgetState().layout,pages:[...model.DEFAULT_SYSTEM_PAGES,{id:'page_reading',title:'阅读',icon:'book',isSystem:false,order:5}]});}
function create(value=initial()){return folder.createSiteFolder(value.desktop,{pageId:'all',targetSiteId:'first',draggedSiteId:'second',folderId:'folder_tools',title:'工具'});}
function valid(desktop,layout=defaultWidgetState().layout){validateWidgetDocument({layout,desktop,todos:[]});return desktop;}
const order=(d,page='all')=>model.getPagePlacements(d,page).map(p=>p.id);

test('folder creation replaces target slot, retains mirrors and input immutability',()=>{
 const input=initial(),original=structuredClone(input);const d=valid(create(input));
 assert.deepEqual(d.folders,[{id:'folder_tools',title:'工具',siteIds:['first','second']}]);
 assert.deepEqual(order(d).slice(-2),['folder_tools','third']);
 assert.deepEqual(order(d,'ai'),['first','second','third']);
 assert.deepEqual(input,original);
});

test('folder add, rename, internal sorting, extraction and automatic dissolution are server-valid',()=>{
 let d=valid(create());
 d=valid(folder.addSiteToFolder(d,{folderId:'folder_tools',siteId:'third',fromPageId:'all'}));
 d=valid(folder.renameSiteFolder(d,{folderId:'folder_tools',title:'收藏'}));
 d=valid(folder.reorderFolderSite(d,{folderId:'folder_tools',siteId:'third',beforeSiteId:'first'}));
 assert.deepEqual(d.folders[0].siteIds,['third','first','second']);
 d=valid(folder.moveFolderSiteToPage(d,{folderId:'folder_tools',siteId:'third',toPageId:'design'}));
 assert.deepEqual(order(d,'design'),['third']);
 d=valid(folder.moveFolderSiteToPage(d,{folderId:'folder_tools',siteId:'second',toPageId:'all'}));
 assert.equal(d.folders.length,0);assert.deepEqual(order(d).slice(-2),['first','second']);
 assert.equal(d.schemaVersion,2,'do not downgrade the document after dissolving its last folder');
});

test('dissolve and deleting a member retain all remaining sites and unresolved references',()=>{
 let d=create();d.folders[0].siteIds.push('other_device_site');valid(d);
 const dissolved=valid(folder.dissolveSiteFolder(d,{folderId:'folder_tools'}));
 assert.deepEqual(order(dissolved).slice(-4),['first','second','other_device_site','third']);
 d=valid(model.removeSitePlacements(d,'second'));
 assert.deepEqual(d.folders[0].siteIds,['first','other_device_site']);
 d=valid(model.removeSitePlacements(d,'first'));
 assert.equal(d.folders.length,0);assert.ok(order(d).includes('other_device_site'));
});

test('moving folders across mirrored pages merges sites and old layout operations preserve folder members',()=>{
 const input=create(),original=structuredClone(input);
 let d=valid(model.movePlacementToPage(input,{fromPageId:'all',toPageId:'ai',kind:'folder',id:'folder_tools'}));
 assert.deepEqual(order(d,'ai'),['third','folder_tools']);
 assert.deepEqual(input,original);
 d=valid(model.placeDesktopItemBefore(d,{fromPageId:'ai',toPageId:'page_reading',kind:'folder',id:'folder_tools'}));
 d=valid(model.deleteDesktopPage(d,'page_reading'));
 assert.equal(d.placements.find(p=>p.kind==='folder').pageId,'all');
 const hidden=model.disableWidget({desktop:d,layout:defaultWidgetState().layout},'calendar');
 valid(hidden.desktop,hidden.layout);assert.deepEqual(hidden.desktop.folders,d.folders);
 const restored=model.enableWidgetOnPage(hidden,{widgetId:'calendar',pageId:'dev'});
 valid(restored.desktop,restored.layout);assert.deepEqual(restored.desktop.folders,d.folders);
});

test('reconciliation and feature cache preserve v2 and unresolved folder members without duplication',()=>{
 const d=create();d.folders[0].siteIds.push('other_device_site');
 const state={...defaultWidgetState(),desktop:d};
 const cached=normalizeWidgetState(state);
 assert.deepEqual(cached.desktop,d);
 const reconciled=model.reconcileDesktopWithLayout(cached.desktop,cached.layout);valid(reconciled.desktop,reconciled.layout);
 assert.deepEqual(reconciled.desktop.folders,d.folders);
 const items=model.getRenderablePageItems({desktop:reconciled.desktop,pageId:'all',sites,layout:state.layout});
 const f=items.find(i=>i.kind==='folder');assert.ok(f);
 assert.ok(f.folder.siteIds.includes('other_device_site'));
 assert.equal(items.filter(i=>i.kind==='site'&&['first','second'].includes(i.id)).length,0);
});

test('folder operations reject same-site grouping and retain all input on capacity failure',()=>{
 const d=create(),before=structuredClone(d);
 assert.deepEqual(folder.createSiteFolder(d,{pageId:'all',targetSiteId:'third',draggedSiteId:'third'}),d);
 assert.deepEqual(folder.renameSiteFolder(d,{folderId:'folder_tools',title:'   '}),d);
 const full=structuredClone(d);full.folders[0].siteIds=Array.from({length:100},(_,i)=>`site_${i}`);
 assert.deepEqual(folder.addSiteToFolder(full,{folderId:'folder_tools',siteId:'third',fromPageId:'all'}),full);
 assert.deepEqual(d,before);
});

test('cross-page folders merge mirrored members without losing the other folder remaining site',()=>{
 let d=create();
 d=folder.createSiteFolder(d,{pageId:'ai',targetSiteId:'second',draggedSiteId:'third',folderId:'folder_ai'});
 valid(d);
 const before=structuredClone(d);
 d=valid(model.movePlacementToPage(d,{fromPageId:'all',toPageId:'ai',kind:'folder',id:'folder_tools'}));
 assert.deepEqual(d.folders,[{id:'folder_tools',title:'工具',siteIds:['first','second']}]);
 assert.deepEqual(order(d,'ai'),['third','folder_tools']);
 assert.equal(before.folders.length,2,'the input document remains intact');
});

test('application merge callbacks create and extend a folder with one atomic save per release',()=>{
 const source=readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8');
 const functions=['commitDesktopAndLayout','ensureDesktopPointerDragController'].map(name=>{
   const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);
   const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end);
 }).join('\n');
 const value=initial(),state={pages:value.desktop.pages,widgetState:{...value,todos:[]},currentPageIndex:0,screenViews:[]};
 const saves=[];let callbacks;
 const context={...model,...folder,state,structuredClone,desktopPointerDragController:null,desktopPointerDragTrackEl:null,
   gestureBlockBlankExit:false,document:{getElementById:()=>({})},
   createDesktopPointerDragController(options){callbacks=options;return{};},
   getEffectiveDesktopForRender:()=>state.widgetState.desktop,
   closeFolderDetailModal(){},savePagesToStorage(){},renderAll(){},renderAddWidgetModalList(){},
   featureClient:{saveWidgetsState:patch=>saves.push(structuredClone(patch))},
 };
 runInNewContext(functions,context);context.ensureDesktopPointerDragController();
 callbacks.onCommitFolderMerge({fromPageId:'all',toPageId:'all',draggedSiteId:'second',targetKind:'site',targetId:'first'});
 assert.equal(saves.length,1);validateWidgetDocument(state.widgetState);
 const id=state.widgetState.desktop.folders[0].id;
 callbacks.onCommitFolderMerge({fromPageId:'all',toPageId:'all',draggedSiteId:'third',targetKind:'folder',targetId:id});
 assert.equal(saves.length,2);validateWidgetDocument(state.widgetState);
 assert.deepEqual(state.widgetState.desktop.folders[0].siteIds,['first','second','third']);
 for(const patch of saves)validateWidgetDocument({...patch,todos:[]});
});

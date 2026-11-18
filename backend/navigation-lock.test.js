import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8');
const start=source.indexOf('const NAVIGATION_IMPORT_BLOCKED_EVENTS');
const end=source.indexOf('const navigationBackupController',start);
assert.ok(start>=0 && end>start);

test('navigation import locks settings, widget dialogs and desktop together; failure unlock restores prior inert state', () => {
  for(const initiallyInert of [false,true]) {
    const listeners=new Map(),attributes=new Map();let cancelled=0,prevented=0,stopped=0;
    const body={inert:initiallyInert,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
    const context={state:{note:'unsaved note',widgetState:{todos:['unsaved todo']}},document:{body},
      window:{addEventListener(name,fn,capture){assert.equal(capture,true);listeners.set(name,fn);},removeEventListener(name,fn,capture){assert.equal(capture,true);assert.equal(listeners.get(name),fn);listeners.delete(name);}},
      desktopPointerDragController:{cancelDrag(){cancelled++;}},cancelActivePageDrag(){cancelled++;}};
    runInNewContext(source.slice(start,end),context);
    context.setNavigationImportEditLock(true);
    assert.equal(cancelled,2);assert.equal(body.inert,true);assert.equal(context.state.navigationImportInProgress,true);
    for(const type of ['click','beforeinput','input','keydown','pointerdown','touchstart','drop']) {
      assert.ok(listeners.has(type));
      listeners.get(type)({cancelable:true,preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;},stopPropagation(){}});
    }
    assert.equal(prevented,7);assert.equal(stopped,7);assert.equal(listeners.has('message'),false);
    assert.equal(context.state.note,'unsaved note');assert.deepEqual(context.state.widgetState.todos,['unsaved todo']);
    context.setNavigationImportEditLock(false);
    assert.equal(body.inert,initiallyInert);assert.equal(listeners.size,0);assert.equal(attributes.has('data-navigation-importing'),false);
    assert.equal(context.state.navigationImportInProgress,false);
  }
});

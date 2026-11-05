import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDockOverflowState,createDockOverflowController} from '../frontend/lib/dock-overflow.js';
class Target {
 constructor(){this.listeners=new Map();this.dataset={};this.classes=new Set();this.scrollLeft=0;this.scrollWidth=800;this.clientWidth=200;this.capture=null;
 this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 emit(name,e){for(const fn of this.listeners.get(name)||[])fn(e);}
 setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
 contains(){return true;}getBoundingClientRect(){return{left:20,right:220,width:200};}
}
function setup(t,{fits=false}={}){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');const window=new Target();const observers=[];const frames=new Map();let frameId=0;
 window.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};window.cancelAnimationFrame=id=>frames.delete(id);
 window.ResizeObserver=class{constructor(fn){this.fn=fn;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 window.scrollTo=()=>assert.fail('Dock must not scroll the document');
 Object.defineProperty(globalThis,'window',{value:window,writable:true,configurable:true});
 const dock=new Target(),scroll=new Target();if(fits)scroll.scrollWidth=150;
 const controller=createDockOverflowController({dockEl:dock,scrollEl:scroll});
 t.after(()=>{controller.destroy();if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 const event=(extra={})=>({pointerId:1,pointerType:'mouse',button:0,clientX:180,clientY:50,cancelable:true,target:{closest:()=>null},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){},...extra});
 return{dock,scroll,controller,event,window,observers,frames};
}

test('Dock uses available width rather than icon count and clamps offsets at either end',()=>{
 assert.equal(getDockOverflowState({scrollWidth:100,clientWidth:100,scrollLeft:50}).isOverflowing,false);
 assert.equal(getDockOverflowState({scrollWidth:100,clientWidth:100,scrollLeft:50}).scrollLeft,0);
 const start=getDockOverflowState({scrollWidth:800,clientWidth:200});assert.equal(start.isOverflowing,true);assert.equal(start.canScrollLeft,false);assert.equal(start.canScrollRight,true);
 const end=getDockOverflowState({scrollWidth:800,clientWidth:200,scrollLeft:900});assert.equal(end.scrollLeft,600);assert.equal(end.canScrollRight,false);
});

test('mouse dragging overflowing Dock scrolls and suppresses the release click without navigating',t=>{
 const s=setup(t);s.scroll.emit('pointerdown',s.event());
 const move=s.event({clientX:40});s.scroll.emit('pointermove',move);
 assert.equal(s.scroll.scrollLeft,140);assert.equal(move.prevented,true);assert.equal(s.scroll.capture,1);
 s.scroll.emit('pointerup',s.event({clientX:40}));assert.equal(s.scroll.capture,null);
 const click=s.event();s.scroll.emit('click',click);assert.equal(click.prevented,true);
});

test('fitting Dock never starts custom drag or consumes ordinary clicks/wheel events',t=>{
 const s=setup(t,{fits:true});s.scroll.emit('pointerdown',s.event());
 const move=s.event({clientX:30});s.scroll.emit('pointermove',move);assert.equal(move.prevented,undefined);assert.equal(s.scroll.scrollLeft,0);
 s.scroll.emit('pointerup',s.event({clientX:30}));const click=s.event();s.scroll.emit('click',click);assert.equal(click.prevented,undefined);
 const wheel=s.event({deltaX:0,deltaY:100});s.scroll.emit('wheel',wheel);assert.equal(wheel.prevented,undefined);
});

test('touch and pen keep native panning without pointer capture, scroll writes or suppressed taps',t=>{
 const s=setup(t);
 for(const pointerType of ['touch','pen']){
  s.scroll.emit('pointerdown',s.event({pointerType}));
  const move=s.event({pointerType,clientX:30});s.scroll.emit('pointermove',move);
  assert.equal(move.prevented,undefined);assert.equal(s.scroll.capture,null);assert.equal(s.scroll.scrollLeft,0);
  const up=s.event({pointerType,clientX:30});s.scroll.emit('pointerup',up);assert.equal(up.prevented,undefined);
  const click=s.event({pointerType});s.scroll.emit('click',click);assert.equal(click.prevented,undefined);
 }
 // Native gestures must not prevent a subsequent ordinary mouse drag.
 s.scroll.emit('pointerdown',s.event());s.scroll.emit('pointermove',s.event({clientX:40}));
 assert.equal(s.scroll.scrollLeft,140);assert.equal(s.scroll.capture,1);
});

test('wider viewport resets overflow and ResizeObserver/listeners are cleaned on replacement',t=>{
 const s=setup(t);s.scroll.scrollLeft=500;s.controller.refresh();
 s.scroll.clientWidth=900;s.observers[0].fn();assert.equal(s.scroll.scrollLeft,0);assert.equal(s.controller.getState().isOverflowing,false);
 s.controller.destroy();assert.ok(s.observers.every(o=>o.disconnected));
 assert.equal([...s.scroll.listeners.values()].reduce((n,set)=>n+set.size,0),0);
 assert.equal([...s.window.listeners.values()].reduce((n,set)=>n+set.size,0),0);
});

test('overflowing Dock translates wheel movement and focus only scrolls its own viewport',t=>{
 const s=setup(t);const wheel=s.event({deltaX:0,deltaY:100});s.scroll.emit('wheel',wheel);
 assert.equal(wheel.prevented,true);assert.equal(s.scroll.scrollLeft,100);
 const item={getBoundingClientRect:()=>({left:340,right:380,width:40})};
 s.scroll.emit('focusin',{target:{closest:()=>item}});assert.ok(s.scroll.scrollLeft>=260);assert.ok(s.scroll.scrollLeft<=600);
});

test('cancelled or additional pointers cannot leave the Dock in a dragging state',t=>{
 const s=setup(t);s.scroll.emit('pointerdown',s.event());s.scroll.emit('pointermove',s.event({clientX:40}));
 s.scroll.emit('pointerdown',s.event({pointerId:2}));assert.equal(s.scroll.capture,null);assert.equal(s.dock.classes.has('is-dock-dragging'),false);
 s.scroll.emit('pointercancel',s.event());s.scroll.emit('pointerup',s.event({pointerId:2}));
 s.scroll.emit('pointerdown',s.event());s.scroll.emit('pointermove',s.event({clientX:80}));assert.ok(s.scroll.scrollLeft>140);
});

test('focus correction survives browser focus scrolling and pending frames are cancelled on replacement',t=>{
 const s=setup(t);
 const last={getBoundingClientRect:()=>({left:780-s.scroll.scrollLeft,right:820-s.scroll.scrollLeft,width:40})};
 const focus=()=>s.scroll.emit('focusin',{target:{closest:()=>last}});
 focus();assert.equal(s.scroll.scrollLeft,600);assert.equal(s.frames.size,1);
 // Simulate the browser's focus default scrolling after the focusin handler.
 s.scroll.scrollLeft=592;const run=s.frames.values().next().value;s.frames.clear();run();
 assert.equal(s.scroll.scrollLeft,600);
 focus();focus();assert.equal(s.frames.size,1);
 s.controller.destroy();assert.equal(s.frames.size,0);
});

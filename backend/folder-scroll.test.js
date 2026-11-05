import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFolderScrollController} from '../frontend/lib/folder-pointer-scroll.js';
class Surface {
 constructor(){this.listeners=new Map();this.scrollHeight=2000;this.clientHeight=200;this.scrollTop=50;this.capture=null;}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 emit(name,e){for(const fn of this.listeners.get(name)||[])fn(e);}
 setPointerCapture(id){this.capture=id;}
 hasPointerCapture(id){return this.capture===id;}
 releasePointerCapture(){this.capture=null;}
}
function setup(t){
 const surface=new Surface();let editing=false,dragging=false,open=true,clears=0;
 const controller=createFolderScrollController({gridEl:surface,scrollEl:surface,isEditing:()=>editing,isDragging:()=>dragging,isOpen:()=>open,clearLongPress:()=>clears++});
 t.after(()=>controller.destroy());
 const event=(extra={})=>({pointerId:3,pointerType:'touch',clientX:100,clientY:400,cancelable:true,target:{closest:()=>null},preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){},...extra});
 return{surface,controller,event,setEditing:v=>{editing=v;},setDragging:v=>{dragging=v;},close:()=>{open=false;controller.cancelScroll();},clears:()=>clears};
}

test('vertical folder touch scroll cancels long press, stays bounded and suppresses the release click',t=>{
 const s=setup(t);s.surface.emit('pointerdown',s.event());
 s.surface.emit('pointermove',s.event({clientY:394}));assert.equal(s.surface.scrollTop,50);assert.equal(s.controller.isScrolling(),false);
 s.surface.emit('pointermove',s.event({clientY:300}));assert.equal(s.surface.scrollTop,150);assert.ok(s.clears()>0);
 s.surface.emit('pointermove',s.event({clientY:-3000}));assert.equal(s.surface.scrollTop,1800);
 s.surface.emit('pointerup',s.event({clientY:300}));assert.equal(s.surface.capture,null);
 const click=s.event();s.surface.emit('click',click);assert.equal(click.prevented,true);
 s.controller.destroy();assert.equal([...s.surface.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);
});

test('editing or active card drag prevents folder scrolling from stealing the pointer',t=>{
 const s=setup(t);s.surface.emit('pointerdown',s.event());s.setEditing(true);
 s.surface.emit('pointermove',s.event({clientY:200}));assert.equal(s.surface.scrollTop,50);
 s.controller.cancelScroll();s.setEditing(false);s.setDragging(true);
 s.surface.emit('pointerdown',s.event({pointerId:4}));s.surface.emit('pointermove',s.event({pointerId:4,clientY:200}));
 assert.equal(s.surface.scrollTop,50);assert.equal(s.controller.isScrolling(),false);
});

test('second finger cancels manual scroll without preventing pinch and subsequent touches work',t=>{
 const s=setup(t);s.surface.emit('pointerdown',s.event());
 const second=s.event({pointerId:4});s.surface.emit('pointerdown',second);assert.equal(second.prevented,undefined);
 const pinch=s.event({clientY:100});s.surface.emit('pointermove',pinch);assert.equal(pinch.prevented,undefined);assert.equal(s.surface.scrollTop,50);
 s.surface.emit('pointerup',s.event());s.surface.emit('pointerup',second);
 s.surface.emit('pointerdown',s.event({pointerId:5}));s.surface.emit('pointermove',s.event({pointerId:5,clientY:300}));assert.equal(s.surface.scrollTop,150);
});

test('mouse input stays native and closing/cancelling a folder clears the scrolling session',t=>{
 const s=setup(t);s.surface.emit('pointerdown',s.event({pointerType:'mouse'}));s.surface.emit('pointermove',s.event({pointerType:'mouse',clientY:100}));assert.equal(s.surface.scrollTop,50);
 s.surface.emit('pointerdown',s.event());s.surface.emit('pointermove',s.event({clientY:300}));assert.equal(s.controller.isScrolling(),true);
 s.close();assert.equal(s.controller.isScrolling(),false);assert.equal(s.surface.capture,null);
 s.surface.emit('pointermove',s.event({clientY:100}));assert.equal(s.surface.scrollTop,150);
});

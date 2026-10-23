import test,{after} from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';import {ConfirmProvider,useConfirm} from './ConfirmDialog';
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
test('confirm uses native top layer, Escape settles false and concurrent confirmations do not orphan callers',async()=>{
 let ask!:ReturnType<typeof useConfirm>,shown=0;const results:boolean[]=[];function Child(){ask=useConfirm();return React.createElement('dialog',{'aria-label':'parent editor'});}
 let r!:ReactTestRenderer;await act(async()=>{r=create(React.createElement(ConfirmProvider,{children:React.createElement(Child)}),{createNodeMock:e=>e.type==='dialog'?{showModal(){shown++;},close(){}}:null});});
 try{await act(async()=>{void ask({title:'确认一'}).then(v=>results.push(v));void ask({title:'确认二'}).then(v=>results.push(v));});const modal=r.root.findAllByType('dialog').find(d=>d.props['aria-label']==='确认一');assert(modal,'confirmation must join native dialog top layer');assert.equal(shown,1);
 await act(async()=>modal.props.onCancel({preventDefault(){}}));assert.deepEqual(results,[false]);const second=r.root.findAllByType('dialog').find(d=>d.props['aria-label']==='确认二');assert(second);await act(async()=>r.root.findAllByType('button').find(b=>b.children.includes('确认'))!.props.onClick());assert.deepEqual(results,[false,true]);
 await act(async()=>{void ask({title:'卸载确认'}).then(v=>results.push(v));});await act(async()=>r.unmount());assert.deepEqual(results,[false,true,false]);
 }finally{if(r)await act(async()=>r.unmount());}
});

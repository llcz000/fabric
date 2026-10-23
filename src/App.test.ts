import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import App from './App';

const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});

async function renderRuntime(payload:unknown){
 const names=['window','fetch','sessionStorage','localStorage','IS_REACT_ACT_ENVIRONMENT'] as const;
 const saved=names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
 const calls:string[]=[],events=new EventTarget(),storage={getItem:()=>null,setItem(){},removeItem(){}};
 const values={window:{location:{pathname:'/',hash:''},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)},
  fetch:async(input:unknown)=>{calls.push(String(input));return Response.json(payload);},sessionStorage:storage,localStorage:storage,IS_REACT_ACT_ENVIRONMENT:true};
 for(const k of names)Object.defineProperty(globalThis,k,{value:values[k],configurable:true,writable:true});
 let renderer:ReactTestRenderer|undefined;
 try{
  await act(async()=>{renderer=create(React.createElement(App));});
  await act(async()=>{await new Promise(r=>setTimeout(r,50));});
  return {tree:renderer.toJSON(),calls,inputs:renderer.root.findAllByType('input').map(n=>n.props.name)};
 }finally{
  if(renderer)await act(async()=>renderer.unmount());
  for(const [k,v] of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}
 }
}
test('legacy runtime response cannot render the retired login or load its business data',async()=>{
 const result=await renderRuntime({mode:'legacy'});
 assert.match(JSON.stringify(result.tree),/服务暂时不可用/);
 assert.deepEqual(result.calls,['/api/runtime']);
 assert.equal(result.inputs.length,0);
});
test('valid V2 runtime reaches the registered-account login',async()=>{
 const result=await renderRuntime({mode:'v2'});
 assert.deepEqual(result.calls,['/api/runtime']);
 assert(result.inputs.includes('username'));
 assert(result.inputs.includes('password'));
});

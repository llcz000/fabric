import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {useV2Company} from './useV2Company';
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
let current:ReturnType<typeof useV2Company>;
function Harness({token,apiFetch}:{token:string;apiFetch:typeof fetch}){current=useV2Company(apiFetch,token);return React.createElement('span',null,current.actor?.username??'loading');}
const me=(name:string)=>({id:'1',username:name,displayName:name,role:'admin'});
const company={company_name:'Company',images:{}};
test('late old identity responses cannot replace the current account or company',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 let resolveOld!:(r:Response)=>void,renderer!:ReactTestRenderer;
 const old=(async(url)=>url==='/api/v2/access/me'?new Promise<Response>(r=>{resolveOld=r;}):Response.json(company)) as typeof fetch;
 const fresh=(async(url)=>Response.json(url==='/api/v2/access/me'?me('new'):url==='/api/company'?company:{productsEnabled:true})) as typeof fetch;
 try{
  await act(async()=>{renderer=create(React.createElement(Harness,{token:'a',apiFetch:old}));});
  await act(async()=>renderer.update(React.createElement(Harness,{token:'b',apiFetch:fresh})));
  assert.equal(current.actor?.username,'new');
  await act(async()=>resolveOld(Response.json(me('old'))));
  assert.equal(current.actor?.username,'new');assert.equal(current.company?.name,'Company');
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});
test('unmount while company image blob is pending cannot create an unreleased object URL',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;let created=0,revoked=0,resolveBlob!:(b:Blob)=>void,renderer!:ReactTestRenderer;
 URL.createObjectURL=()=>{created++;return 'blob:test';};URL.revokeObjectURL=()=>{revoked++;};
 const api=(async(url)=>url==='/api/v2/access/me'?Response.json(me('one')):url==='/api/company'?Response.json({...company,images:{brand_logo:{source:'asset',assetId:'x',displayUrl:'/api/company/images/brand_logo/content'}}}):url==='/api/v2/pattern-sharing'?Response.json({productsEnabled:true}):{ok:true,blob:()=>new Promise<Blob>(r=>{resolveBlob=r;})}) as typeof fetch;
 try{
  await act(async()=>{renderer=create(React.createElement(Harness,{token:'a',apiFetch:api}));});
  assert.equal(typeof resolveBlob,'function');await act(async()=>renderer.unmount());
  await act(async()=>resolveBlob(new Blob(['image'])));
  assert.equal(created,0);assert.equal(revoked,0);
 }finally{URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

test('new share entry follows card readiness independently of legacy product share capability',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});let renderer!:ReactTestRenderer;
 try{for(const capabilities of [{productsEnabled:true,cardsEnabled:false},{productsEnabled:false,cardsEnabled:true}]){const api=(async(url)=>Response.json(url==='/api/v2/access/me'?me('one'):url==='/api/company'?company:capabilities)) as typeof fetch;await act(async()=>{if(renderer)renderer.update(React.createElement(Harness,{token:'a',apiFetch:api}));else renderer=create(React.createElement(Harness,{token:'a',apiFetch:api}));});assert.equal(current.shareEnabled,capabilities.cardsEnabled);}}
 finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

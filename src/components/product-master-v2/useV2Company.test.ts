import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {useV2Company} from './useV2Company';
import CompanyProfileEditor from '../CompanyProfileEditor';
import type {CompanyProfile} from '../../types';
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
let current:ReturnType<typeof useV2Company>;
function Harness({token,apiFetch}:{token:string;apiFetch:typeof fetch}){current=useV2Company(apiFetch,token);return React.createElement('span',null,current.actor?.username??'loading');}
const me=(name:string)=>({id:'1',username:name,displayName:name,role:'admin'});
const company={company_name:'Company',images:{}};

test('late remote settings images preserve text edits and explicit image removal mutations',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});let renderer!:ReactTestRenderer;
 let submitted:any,mutations:any;
 const profile={name:'Company',logoText:'Brand',address:'Address',phone:'123',defaultTerms:'',logoType:'image',logoUrl:'blob:old',companyImages:{brand_logo:{role:'brand_logo',source:'asset',assetId:'old',displayUrl:'blob:old'}}} as CompanyProfile;
 const props={profile,apiFetch:fetch,onSave:async(p:CompanyProfile,m:unknown)=>{submitted=p;mutations=m;}};
 try{
  await act(async()=>{renderer=create(React.createElement(CompanyProfileEditor,props));});
  await act(async()=>renderer.root.findAllByType('input').find(node=>node.props.id==='company-name-input')!.props.onChange({target:{value:'Unsaved name'}}));
  const remove=renderer.root.findAllByType('button').find(b=>b.children.some(c=>c==='删除Logo图片'))!;assert(remove);
  await act(async()=>remove.props.onClick());
  await act(async()=>renderer.update(React.createElement(CompanyProfileEditor,{...props,profile:{...profile,weChatPayUrl:'blob:late',companyImages:{...profile.companyImages,wechat_qr:{role:'wechat_qr',source:'asset',displayUrl:'blob:late'}}}})));
  assert.equal(renderer.root.findAllByType('input').find(node=>node.props.id==='company-name-input')!.props.value,'Unsaved name');
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(submitted.name,'Unsaved name');assert.deepEqual(mutations,[{role:'brand_logo',action:'remove'}]);
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

test('image HTTP and network failures do not block identity, text settings or other images',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});let renderer!:ReactTestRenderer;
 try{for(const network of [false,true]){
  const api=(async(url)=>{
   if(url==='/api/v2/access/me')return Response.json(me('one'));
   if(url==='/api/company')return Response.json({...company,images:Object.fromEntries(['brand_logo','wechat_qr'].map(role=>[role,{source:'asset',displayUrl:'/api/company/images/'+role+'/content'}]))});
   if(url==='/api/v2/pattern-sharing')return Response.json({cardsEnabled:true});
   if(String(url).includes('brand_logo')){if(network)throw Error('offline');return new Response('',{status:503});}
   return new Response(new Blob(['ok'],{type:'image/png'}));
  }) as typeof fetch;
  await act(async()=>{if(renderer)renderer.update(React.createElement(Harness,{token:'a',apiFetch:api}));else renderer=create(React.createElement(Harness,{token:'a',apiFetch:api}));});
  assert.equal(current.actor?.username,'one');assert.equal(current.company?.name,'Company');assert.equal(current.error,'');
  assert.equal(current.company?.logoType,'text');assert.match(current.company?.weChatPayUrl??'',/^blob:/);
 }}finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

test('a pending image cannot hold the workspace loading state',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});let renderer!:ReactTestRenderer;
 const api=(async(url)=>url==='/api/v2/access/me'?Response.json(me('one')):url==='/api/company'?Response.json({...company,images:{brand_logo:{source:'asset',displayUrl:'/api/company/images/brand_logo/content'}}}):url==='/api/v2/pattern-sharing'?Response.json({cardsEnabled:true}):new Promise<Response>(()=>{})) as typeof fetch;
 try{await act(async()=>{renderer=create(React.createElement(Harness,{token:'a',apiFetch:api}));});assert.equal(current.actor?.username,'one');assert.equal(current.company?.name,'Company');}
 finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});
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

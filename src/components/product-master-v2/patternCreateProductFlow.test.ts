import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {ProductEditorV2} from './ProductEditorV2';
import {ProductCatalogWorkspaceV2} from './ProductCatalogWorkspaceV2';
import {renderToStaticMarkup} from 'react-dom/server';

const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=NativeChannel;});
const master={id:'11',masterNo:'G017',isActive:true,nextColorwayNo:3,topicTags:[{id:'7',name:'小碎花',isArchived:false}],colorTags:[],versions:[
 {id:'112',masterId:'11',colorwayNo:2,patternNo:'G017-2',patternImageAssetId:null,remark:'',isActive:true,colorTags:[]}
]};
const fabrics=[
 {id:'8',fabricNo:'F018',fabricName:'轻柔雪纺',composition:'100%真丝',weightValue:16.5,weightUnit:'mm',widthValue:145,remark:null,isActive:true,productCount:0},
 {id:'9',fabricNo:'F019',fabricName:'印花棉布',composition:'全棉',weightValue:130,weightUnit:'gsm',widthValue:150,remark:null,isActive:true,productCount:0}
];
test('pattern-list navigation starts product-create directly; prefill is checked against active colorway, fabric can be searched by name and browsed',async()=>{
 const html=renderToStaticMarkup(React.createElement(ProductCatalogWorkspaceV2,{
  apiFetch:fetch,canManage:true,initialPatternNo:'G017-2',initialPatternId:'112'
 }));
 assert(html.includes('新增产品'));
 const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const originalAct=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
 const win=new EventTarget(),doc=new EventTarget();
 Object.defineProperty(globalThis,'window',{value:Object.assign(win,{confirm:()=>true}),configurable:true,writable:true});
 Object.defineProperty(globalThis,'document',{value:doc,configurable:true,writable:true});
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true,writable:true});
 const requests:string[]=[];
 const api=(async(url:RequestInfo|URL)=>{
  const href=String(url);requests.push(href);
  if(href.startsWith('/api/v2/pattern-catalog?'))return Response.json({items:[master],total:1,limit:20,offset:0});
  if(href.startsWith('/api/v2/fabrics/catalog?')){
   const name=new URL(href,'https://app.invalid').searchParams.get('query')??'';
   const filtered=fabrics.filter(x=>!name||x.fabricNo.includes(name)||x.fabricName.includes(name));
   return Response.json({items:filtered,total:filtered.length,limit:50,offset:0});
  }
  throw Error('unexpected request '+href);
 }) as typeof fetch;
 let renderer:ReactTestRenderer|undefined;
 try{
  await act(async()=>{renderer=create(React.createElement(ProductEditorV2,{
   mode:'create',apiFetch:api,canManage:true,prefillPatternId:'112',prefillPatternNo:'G017-2',onCancel:()=>{},onSaved:()=>{}
  }));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  const readAuto=()=>renderer!.root.findAllByType('input').find(x=>x.props['aria-label']==='自动货号')!.props.value;
  assert.equal(readAuto(),'待选面料');
  assert(renderer!.root.findAllByType('button').some(x=>x.props['aria-label']==='选择花型版本'&&x.props.children));
  const search=()=>renderer!.root.findAllByType('input').find(x=>x.props['aria-label']==='输入面料品号或品名')!;
  await act(async()=>search().props.onFocus());
  await act(async()=>search().props.onChange({target:{value:'雪纺'}}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,250));});
  assert(requests.some(x=>x.includes('query=%E9%9B%AA%E7%BA%BA')),'search term sent to fabric catalog');
  const choice=renderer!.root.findAllByType('button').find(x=>x.props.role==='option'&&x.props.children);
  assert(choice,'matching fabric appears in dropdown');
  await act(async()=>choice!.props.onClick());
  assert.equal(readAuto(),'G017-2-F018');
  assert(search().props.value.includes('F018'));
  await act(async()=>renderer!.root.findAllByType('button').find(x=>x.props['aria-label']==='展开面料选项')!.props.onClick());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,250));});
  assert(renderer!.root.findAllByType('button').some(x=>x.props.role==='option'),'empty query supports dropdown browsing');
 }finally{
  if(renderer)await act(async()=>renderer.unmount());
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else Reflect.deleteProperty(globalThis,'window');
  if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');
  if(originalAct)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',originalAct);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');
 }
});

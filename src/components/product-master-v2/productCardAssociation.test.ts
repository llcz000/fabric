import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {CatalogV2Table,ProductCatalogV2} from './ProductCatalogV2';
import {buildCatalogUrl,emptyCatalogFilters,reduceCatalogFilters,parseCatalogPage,type CatalogProduct} from './catalogModel';

const product:CatalogProduct={id:'1',productNo:'G01-1-F01',patternColorwayId:'11',fabricId:'8',masterId:'7',masterNo:'G01',colorwayNo:1,fabricNo:'F01',fabricName:'Silk',composition:null,weightValue:19.99,weightUnit:'mm',widthCm:145.01,remark:'note',isActive:true,isAvailableForSampling:true,masterActive:true,colorwayActive:true,fabricActive:true,isSelectable:true,rowVersion:'1',patternImageAssetId:null,topicTags:[],colorTags:[],imageCounts:{fabricDisplay:0,detail:0,aiEffect:0},totalImages:0};
const page=(item:CatalogProduct)=>({items:[item],total:1,limit:50,offset:0});
const table=(item:CatalogProduct,canManage=true)=>renderToStaticMarkup(React.createElement(CatalogV2Table,{page:page(item),canManage,patternUrls:new Map(),onPatternPreview(){},onProductImages(){},onPage(){},onCard(){},onCreateCard(){}}));
test('product row shows a current card and independent disabled/reprint states after its own remark',()=>{
 const html=table({...product,sampleCard:{id:'17',cardNo:'G01-F01',isActive:false,needsReprint:true}});
 assert.match(html,/关联色卡/);assert.match(html,/G01-F01/);assert.match(html,/色卡已停用/);assert.match(html,/需重新打印/);
 assert.ok(html.indexOf('>备注<')<html.indexOf('>关联色卡<'));assert.ok(html.indexOf('>关联色卡<')<html.indexOf('>启用状态<'));
 const cells=[...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
 assert.match(cells[1],/G01-1-F01/);assert.match(cells[7],/note/);assert.match(cells[8],/G01-F01/);
});
test('missing association offers explicit creation only to managers and never labels unread data unlinked',()=>{
 assert.match(table({...product,sampleCard:null}),/去建色卡/);
 assert.doesNotMatch(table({...product,sampleCard:null},false),/去建色卡/);
 assert.match(table(product),/关联待读取/);
});
test('association selection resets paging and is carried to list/export URL',()=>{
 const value=reduceCatalogFilters({...emptyCatalogFilters,productNo:' G01 ',fabricName:'Silk',offset:50},{type:'cardAssociation',value:'unlinked'});
 assert.equal(value.offset,0);assert.equal(value.productNo,' G01 ');
 const url=new URL(buildCatalogUrl('/api/v2/products',value),'https://t.invalid');
 assert.equal(url.searchParams.get('cardAssociation'),'unlinked');assert.equal(url.searchParams.get('productNo'),'G01');
 assert.equal(reduceCatalogFilters(value,{type:'reset'}).cardAssociation,'all');
 const html=renderToStaticMarkup(React.createElement(ProductCatalogV2,{apiFetch:fetch}));assert.match(html,/aria-label="色卡关联"/);
});
test('malformed card metadata is rejected rather than rendered as a usable association',()=>{
 for(const sampleCard of [{id:'17',cardNo:'G01-F01',isActive:'false',needsReprint:false},{id:'0',cardNo:'G01-F01',isActive:true,needsReprint:false},{id:'17',cardNo:'',isActive:true,needsReprint:false}])assert.throws(()=>parseCatalogPage(page({...product,sampleCard} as never)));
});
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
test('unlinked product opens prefilled confirmation, writes once only after confirm and protects busy close',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 let renderer!:ReactTestRenderer,finish!:(r:Response)=>void,writes=0;const bodies:unknown[]=[];
 const api=(async(input,init)=>{
  if(init?.method==='POST'){writes++;bodies.push(JSON.parse(String(init.body)));return new Promise<Response>(resolve=>{finish=resolve;});}
  return Response.json(page({...product,sampleCard:null}));
 }) as typeof fetch;
 const find=(label:string)=>renderer.root.findAllByType('button').find(x=>x.props['aria-label']===label||x.children.filter(x=>typeof x==='string').join('')===label);
 try{
  await act(async()=>{renderer=create(React.createElement(ProductCatalogV2,{apiFetch:api,canManage:true}));await new Promise(resolve=>setTimeout(resolve,20));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  const createButton=find('为产品 G01-1-F01 建色卡');assert.ok(createButton,'unlinked product must expose creation');
  await act(async()=>createButton.props.onClick());assert.equal(writes,0);
  let dialog=renderer.root.findAllByType('dialog').find(x=>x.props['aria-label']==='为产品建色卡');assert.ok(dialog);
  const text=(node:any):string=>node.children.map((child:any)=>typeof child==='string'?child:text(child)).join('');
  assert.match(text(dialog),/G01/);assert.match(text(dialog),/F01/);
  await act(async()=>find('取消建色卡')!.props.onClick());assert.equal(writes,0);
  assert.equal(renderer.root.findAllByType('dialog').length,0);
  await act(async()=>find('为产品 G01-1-F01 建色卡')!.props.onClick());
  dialog=renderer.root.findAllByType('dialog').find(x=>x.props['aria-label']==='为产品建色卡');
  const confirm=find('确认生成色卡');assert.ok(confirm);
  await act(async()=>{confirm.props.onClick();confirm.props.onClick();});
  assert.equal(writes,1);assert.deepEqual(bodies,[{masterId:'7',fabricId:'8'}]);
  await act(async()=>dialog!.props.onCancel({preventDefault(){}}));
  assert.equal(renderer.root.findAllByType('dialog').filter(x=>x.props['aria-label']==='为产品建色卡').length,1);
  await act(async()=>finish(Response.json({error:'changed'},{status:409})));
  const alert=renderer.root.findByProps({role:'alert'});assert.ok(text(alert).trim().length>0,'failure must remain visible in the confirmation');
  await act(async()=>find('取消建色卡')!.props.onClick());
  assert.equal(renderer.root.findAllByType('dialog').length,0);
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});
test('successful duplicate-safe creation closes confirmation and refreshes the association from the server',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 let renderer!:ReactTestRenderer,created=false,writes=0;
 const card={id:'17',masterId:'7',masterNo:'G01',fabricId:'8',fabricNo:'F01',cardNo:'G01-F01',description:'Silk',composition:null,weightValue:19.99,weightUnit:'mm',widthValue:145.01,qrPayload:'a'.repeat(32),isActive:true};
 const api=(async(_input,init)=>{
  if(init?.method==='POST'){created=true;writes++;return Response.json({card,created:false});}
  return Response.json(page({...product,sampleCard:created?{id:'17',cardNo:'G01-F01',isActive:true,needsReprint:false}:null}));
 }) as typeof fetch;
 const button=(label:string)=>renderer.root.findAllByType('button').find(x=>x.props['aria-label']===label)!;
 try{
  await act(async()=>{renderer=create(React.createElement(ProductCatalogV2,{apiFetch:api,canManage:true}));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  await act(async()=>button('为产品 G01-1-F01 建色卡').props.onClick());
  await act(async()=>button('确认生成色卡').props.onClick());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  assert.equal(writes,1);assert.equal(renderer.root.findAllByType('dialog').length,0);
  assert.ok(button('查看关联色卡 G01-F01'));assert.ok(renderer.root.findAllByProps({role:'status'}).some(node=>JSON.stringify(node.props.children).includes('已复用现有色卡')));
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

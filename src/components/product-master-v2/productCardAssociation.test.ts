import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {CatalogV2Table,ProductCatalogV2} from './ProductCatalogV2';
import {buildCatalogUrl,emptyCatalogFilters,reduceCatalogFilters,parseCatalogPage,type CatalogProduct} from './catalogModel';

const product:CatalogProduct={id:'1',productNo:'G01-1-F01',patternColorwayId:'11',fabricId:'8',masterId:'7',masterNo:'G01',colorwayNo:1,fabricNo:'F01',fabricName:'Silk',composition:null,weightValue:19.99,weightUnit:'mm',widthCm:145.01,remark:'note',isActive:true,isAvailableForSampling:true,masterActive:true,colorwayActive:true,fabricActive:true,isSelectable:true,rowVersion:'1',patternImageAssetId:null,topicTags:[],colorTags:[],imageCounts:{fabricDisplay:0,detail:0,aiEffect:0},totalImages:0};
const page=(item:CatalogProduct)=>({items:[item],total:1,limit:50,offset:0});
const table=(item:CatalogProduct,canManage=true)=>renderToStaticMarkup(React.createElement(CatalogV2Table,{page:page(item),canManage,patternUrls:new Map(),onPatternPreview(){},onProductImages(){},onPage(){},onCard(){}}));
test('product row shows a current card and independent disabled/reprint states after its own remark',()=>{
 const html=table({...product,sampleCard:{id:'17',cardNo:'G01-F01',isActive:false,needsReprint:true}});
 assert.match(html,/关联色卡/);assert.match(html,/G01-F01/);assert.match(html,/需重新打印/);
 assert.ok(html.indexOf('>备注<')<html.indexOf('>关联色卡<'));assert.ok(html.indexOf('>关联色卡<')<html.indexOf('>操作<'));
 const cells=[...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
 assert.match(cells[1],/G01-1-F01/);assert.match(cells[7],/note/);assert.match(cells[8],/G01-F01/);
});
test('missing association has no manual creation and never labels unread data unlinked',()=>{
 assert.doesNotMatch(table({...product,sampleCard:null}),/去建色卡/);assert.match(table({...product,sampleCard:null}),/待补齐/);
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
test('unlinked product never opens manual card creation or submits a card write',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 let renderer!:ReactTestRenderer,writes=0;
 const api=(async(_input,init)=>{if(init?.method==='POST')writes++;return Response.json(page({...product,sampleCard:null}));}) as typeof fetch;
 try{
  await act(async()=>{renderer=create(React.createElement(ProductCatalogV2,{apiFetch:api,canManage:true}));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  assert.equal(renderer.root.findAllByType('button').filter(x=>String(x.props['aria-label']).includes('建色卡')).length,0);
  assert.equal(renderer.root.findAllByType('dialog').length,0);assert.equal(writes,0);
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

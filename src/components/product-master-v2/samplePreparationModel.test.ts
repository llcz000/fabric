// AC-177
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {SamplePreparationSummary} from './SamplePreparationSummary';
import {SampleSessionDirectory} from './SampleSessionDirectory';
import {ConfirmProvider} from '../ui/ConfirmDialog';
import {ToastProvider} from '../ui/Toast';
import {fetchPreparationSummary} from './samplePreparationModel';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
const previousDocument=globalThis.document;
(globalThis as any).document={addEventListener(){},removeEventListener(){}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;(globalThis as any).document=previousDocument;});
const summary={rows:[{productId:'100',cardId:'12',cardNo:'G0907-F018',patternNo:'G0907-1',patternImageAssetId:null,quantity:2,recipients:[{customerName:'甲公司',contactName:'张'},{customerName:'甲公司',contactName:'李'}]}]};
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?text(node.children):'';
test('summary renders only four business columns with exact recipients and quantities',async()=>{
 let renderer:ReactTestRenderer;const requests:any[]=[];
 await act(async()=>{renderer=create(React.createElement(SamplePreparationSummary,{apiFetch:async(input:any,init:any)=>{requests.push([input,JSON.parse(init.body)]);return Response.json(summary);},sessionIds:['41','42'],onClose(){},onAccessLost(){},onBlocked(){}}));});
 assert.deepEqual(renderer!.root.findAllByType('th').map(th=>text(th.children)),['色卡编号','配色缩略图','份数','客户／联系人']);
 const result=text(renderer!.toJSON());assert(result.includes('G0907-1'));assert(result.includes('甲公司／张'));assert(result.includes('甲公司／李'));assert(result.includes('暂无图片'));
 assert.deepEqual(requests,[['/api/v2/customer-samples/sessions/preparation',{sessionIds:['41','42']}] ]);
 await act(async()=>renderer!.unmount());
});
test('transient failure can retry, access loss clears results and late responses never refill unmounted view',async()=>{
 let renderer:ReactTestRenderer,calls=0,lost=0;const send=async()=>++calls===1?Response.json({},{status:503}):Response.json(summary);
 await act(async()=>{renderer=create(React.createElement(SamplePreparationSummary,{apiFetch:send,sessionIds:['41'],onClose(){},onAccessLost(){lost++;},onBlocked(){}}));});
 assert(text(renderer!.toJSON()).includes('读取失败'));
 await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='重试')!.props.onClick());assert(text(renderer!.toJSON()).includes('甲公司／李'));
 await act(async()=>renderer!.unmount());
 await act(async()=>{renderer=create(React.createElement(SamplePreparationSummary,{apiFetch:async()=>Response.json({},{status:403}),sessionIds:['41'],onClose(){},onAccessLost(){lost++;},onBlocked(){}}));});
 assert.equal(lost,1);assert(!text(renderer!.toJSON()).includes('甲公司'));await act(async()=>renderer!.unmount());
 let signal:AbortSignal|undefined,resolve!:(r:Response)=>void;
 await act(async()=>{renderer=create(React.createElement(SamplePreparationSummary,{apiFetch:async(_input:any,init:any)=>{signal=init.signal;return new Promise<Response>(r=>{resolve=r;});},sessionIds:['41'],onClose(){},onAccessLost(){lost++;},onBlocked(){}}));});
 await act(async()=>renderer!.unmount());assert.equal(signal?.aborted,true);await act(async()=>resolve(Response.json(summary)));assert.equal(lost,1);
});
test('summary pagination signs only visible unique thumbnail assets and does not change quantities',async()=>{
 const ids:string[][]=[],rows=Array.from({length:21},(_,i)=>({...summary.rows[0],productId:String(100+i),patternNo:'G0907-'+(i+1),patternImageAssetId:'dddddddd-4444-4444-8444-'+String(i+1).padStart(12,'0')}));
 let renderer:ReactTestRenderer;
 await act(async()=>{renderer=create(React.createElement(SamplePreparationSummary,{apiFetch:async()=>Response.json({rows}),sessionIds:['41'],resolveImages:async(part,variant)=>{assert.equal(variant,'thumbnail');ids.push(part);return new Map(part.map(id=>[id,'data:image/svg+xml,<svg/>']));},onClose(){},onAccessLost(){},onBlocked(){}}));});
 assert.equal(renderer!.root.findAllByType('img').length,20);assert.equal(ids.flat().length,20);
 await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='下一页')!.props.onClick());
 assert.equal(renderer!.root.findAllByType('img').length,1);assert.equal(ids.flat().length,21);assert.equal(renderer!.root.findAllByType('strong')[0].children[0],'2');
 await act(async()=>renderer!.unmount());
});
test('client rejects malformed counts and duplicate rows, and only accepts a blocker from requested orders',async()=>{
 const c=new AbortController();
 for(const rows of [[{...summary.rows[0],quantity:1}],[summary.rows[0],summary.rows[0]]])await assert.rejects(fetchPreparationSummary(async()=>Response.json({rows}),['41'],c.signal),/汇总数据/);
 let calls=0;await assert.rejects(fetchPreparationSummary(async()=>{calls++;return Response.json(summary);},['41','41'],c.signal));assert.equal(calls,0);
 await assert.rejects(fetchPreparationSummary(async()=>Response.json({error:'BATCH_SELECTION_BLOCKED',sessionId:'99',reason:'review'},{status:409}),['41'],c.signal),e=>(e as any).status===409);
});
test('directory opens exact checked orders and returning preserves selection',async()=>{
 const previousFrame=globalThis.requestAnimationFrame;(globalThis as any).requestAnimationFrame=(fn:()=>void)=>{fn();return 1;};
 const item={id:'41',customerReference:'甲公司',contactName:'张',createdAt:'2026-11-08T00:00:00.000Z',selectedCardCount:1,selectedProductCount:1};
 const apiFetch:typeof fetch=async(input,init)=>{
  if(String(input).endsWith('/capability'))return Response.json({enabled:true});
  if(String(input).endsWith('/preparation')){assert.deepEqual(JSON.parse(String(init?.body)),{sessionIds:['41']});return Response.json(summary);}
  return Response.json({items:[item],total:1,limit:20,offset:0});
 };
 let renderer:ReactTestRenderer;
 try{
  await act(async()=>{renderer=create(React.createElement(ConfirmProvider,null,React.createElement(ToastProvider,null,React.createElement(SampleSessionDirectory,{apiFetch}))));});
  await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='多选')!.props.onClick());
  await act(async()=>renderer!.root.findByType('input').props.onChange({target:{checked:true}}));
  await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='查看汇总')!.props.onClick());
  assert(text(renderer!.toJSON()).includes('甲公司／李'));
  await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='返回客户选样')!.props.onClick());
  assert.equal(renderer!.root.findByType('input').props.checked,true);assert(text(renderer!.toJSON()).includes('已选 1 单'));
 }finally{await act(async()=>renderer!.unmount());globalThis.requestAnimationFrame=previousFrame;}
});
test('a background directory denial also removes an already open private summary',async()=>{
 let renderer:ReactTestRenderer,resolveDirectory!:(r:Response)=>void;
 const apiFetch:typeof fetch=async input=>{
  if(String(input).endsWith('/capability'))return Response.json({enabled:true});
  if(String(input).endsWith('/preparation'))return Response.json(summary);
  if(new URL(String(input),'http://local').searchParams.get('query'))return new Promise<Response>(r=>{resolveDirectory=r;});
  return Response.json({items:[{id:'41',customerReference:'甲公司',createdAt:'2026-11-08T00:00:00.000Z',selectedCardCount:1,selectedProductCount:1}],total:1,limit:20,offset:0});
 };
 try{
  await act(async()=>{renderer=create(React.createElement(ConfirmProvider,null,React.createElement(ToastProvider,null,React.createElement(SampleSessionDirectory,{apiFetch}))));});
  await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='多选')!.props.onClick());
  await act(async()=>renderer!.root.findByType('input').props.onChange({target:{checked:true}}));
  await act(async()=>renderer!.root.findAllByType('button').find(b=>b.props['aria-label']==='搜索选样单')!.props.onClick());
  await act(async()=>renderer!.root.findAllByType('input').find(i=>i.props.type==='search')!.props.onChange({target:{value:'甲'}}));
  await act(async()=>{await new Promise(r=>setTimeout(r,270));});
  await act(async()=>renderer!.root.findAllByType('button').find(b=>text(b.children)==='查看汇总')!.props.onClick());assert(text(renderer!.toJSON()).includes('甲公司／李'));
  await act(async()=>resolveDirectory(Response.json({},{status:403})));assert(!text(renderer!.toJSON()).includes('甲公司／李'));
 }finally{await act(async()=>renderer!.unmount());}
});

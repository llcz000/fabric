import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {PublicCardGallery} from './PublicCardGallery';
import {CardShareDialog} from './CardShareDialog';
import {parsePublicCardResponse,parseCardShareLink,publicCardImagePath} from './publicPatternClient';
import {SampleCardTable} from '../product-master-v2/SampleCardTable';
import {SampleCardLibraryV2} from '../product-master-v2/SampleCardLibraryV2';
import type {PublicCard} from '../../../server/customer-share/cardShareCatalog';
const ref='display:'+'x'.repeat(43),token='a'.repeat(43);
const card:PublicCard={cardNo:'G001-F005',fabricNo:'F005',fabricName:'真丝',composition:null,weightValue:18,weightUnit:'mm',widthCm:145,colorways:[{colorwayNo:1,productNo:'G001-1-F005',displayImages:[],detailImages:[],effectImages:[]},{colorwayNo:2,productNo:'G001-2-F005',displayImages:[{previewRef:ref}],detailImages:[],effectImages:[]}]};
test('public card gallery renders every colorway and all three image groups without borrowing from siblings',()=>{
 const html=renderToStaticMarkup(React.createElement(PublicCardGallery,{card,renderPreview:(_ref,description)=>React.createElement('img',{alt:description})}));
 assert.match(html,/G001-1-F005/);assert.match(html,/G001-2-F005/);assert.match(html,/18 mm/);assert.match(html,/暂无图片/);
 assert.equal((html.match(/面料大图/g)??[]).length>=2,true);assert.equal((html.match(/细节图/g)??[]).length>=2,true);assert.equal((html.match(/效果图/g)??[]).length>=2,true);
 assert.equal((html.match(/<img/g)??[]).length,1);assert.doesNotMatch(html,/花型设计图/);
});
test('card public client rejects internal fields, malformed group identities and wrong share destinations',()=>{
 assert.deepEqual(parsePublicCardResponse({available:true,card}),card);assert.equal(parsePublicCardResponse({available:false,message:'暂不可用'}),null);
 for(const modified of [{...card,cardId:'18'},{...card,colorways:[card.colorways[0],card.colorways[0]]},{...card,colorways:[{...card.colorways[0],displayImages:[{previewRef:'/api/private'}]}]},{...card,weightUnit:null}])assert.throws(()=>parsePublicCardResponse({available:true,card:modified}));
 assert.equal(parseCardShareLink('https://share.example.test/c/'+token,'https://share.example.test').path,'/c/'+token);
 for(const url of ['http://share.example.test/c/'+token,'https://evil.example.test/c/'+token,'https://share.example.test/s/'+token,'https://share.example.test/c/'+token+'?scope=all'])assert.throws(()=>parseCardShareLink(url,'https://share.example.test'));
 assert.equal(publicCardImagePath(token,ref),'/api/public/cards/'+token+'/images/'+ref.slice(8));
});
test('card table exposes share only when explicitly enabled and never for an inactive card',()=>{
 const item={id:'18',masterId:'4',masterNo:'G001',fabricId:'5',fabricNo:'F005',cardNo:card.cardNo,description:'真丝',composition:null,weightValue:18,weightUnit:'mm' as const,widthValue:145,qrPayload:'q'.repeat(43),isActive:true};
 const props={page:{items:[item],total:1,limit:50,offset:0},selectedIds:[],onToggle(){},onPageAll(){},onPage(){},onShare(){}};
 assert.match(renderToStaticMarkup(React.createElement(SampleCardTable,props)),/分享花型产品 G001-F005/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(SampleCardTable,{...props,onShare:undefined})),/分享花型产品/);
 const inactive=renderToStaticMarkup(React.createElement(SampleCardTable,{...props,page:{...props.page,items:[{...item,isActive:false}]}}));assert.match(inactive,/disabled/);
});
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
test('whole card library opens the selected card share dialog and requests its public link',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const item={id:'18',masterId:'4',masterNo:'G001',fabricId:'5',fabricNo:'F005',cardNo:card.cardNo,description:'真丝',composition:null,weightValue:18,weightUnit:'mm',widthValue:145,qrPayload:'q'.repeat(43),isActive:true};
 const writes:string[]=[];let renderer!:ReactTestRenderer;
 const api=(async(url,init)=>{if(init?.method==='POST'){writes.push(String(url));return Response.json({url:'https://share.example.test/c/'+token},{status:201});}return Response.json({items:[item],total:1,limit:50,offset:0});}) as typeof fetch;
 try{
  await act(async()=>{renderer=create(React.createElement(SampleCardLibraryV2,{apiFetch:api,shareEnabled:true}));});
  const button=renderer.root.findAllByType('button').find(x=>x.props['aria-label']==='分享花型产品 '+card.cardNo);assert(button);
  await act(async()=>button.props.onClick());
  assert.equal(renderer.root.findAllByType('dialog').length,1);
  assert.deepEqual(writes,['/api/v2/sample-cards/18/share']);
  assert(renderer.root.findAllByType('input').some(x=>x.props.value==='https://share.example.test/c/'+token));
  await act(async()=>renderer.root.findByType('dialog').props.onCancel({preventDefault(){}}));
  assert.equal(renderer.root.findAllByType('dialog').length,0);
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});
test('card share dialog writes to the exact card, protects busy cancellation and offers the returned public link',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 let renderer!:ReactTestRenderer,finish!:(r:Response)=>void,closed=0,writes=0;
 const api=(async(url,init)=>{writes++;assert.equal(url,'/api/v2/sample-cards/18/share');assert.equal(init?.body,'{}');return new Promise<Response>(resolve=>{finish=resolve;});}) as typeof fetch;
 try{
  await act(async()=>{renderer=create(React.createElement(CardShareDialog,{card:{id:'18',cardNo:card.cardNo},apiFetch:api,onClose(){closed++;}}));});
  const dialog=renderer.root.findByType('dialog');await act(async()=>dialog.props.onCancel({preventDefault(){}}));assert.equal(closed,0);
  await act(async()=>{finish(Response.json({url:'https://share.example.test/c/'+token},{status:201}));});assert.equal(writes,1);
  assert.equal(renderer.root.findByType('input').props.value,'https://share.example.test/c/'+token);
  await act(async()=>dialog.props.onCancel({preventDefault(){}}));assert.equal(closed,1);
 }finally{if(renderer)await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
});

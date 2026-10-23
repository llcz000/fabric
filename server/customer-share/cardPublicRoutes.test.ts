import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createPublicCardRouter} from './cardPublicRoutes';
import {deriveCardShareToken} from './cardSharing';
import {hashPatternLinkToken} from './patternLinkToken';
import type {PublicCard} from './cardShareCatalog';
const token=deriveCardShareToken('18',Buffer.alloc(32,7)),ref='display:'+'x'.repeat(43);
const card:PublicCard={cardNo:'G001-F005',fabricNo:'F005',fabricName:'真丝',composition:null,weightValue:18,weightUnit:'mm',widthCm:145,colorways:[{colorwayNo:1,productNo:'G001-1-F005',displayImages:[{previewRef:ref}],detailImages:[],effectImages:[]},{colorwayNo:2,productNo:'G001-2-F005',displayImages:[],detailImages:[],effectImages:[]}]};
test('public card JSON/images require current publication and scope before and after asynchronous reads',async()=>{
 const state={active:1,deleted:false,related:true,withdraw:false,changeScope:false,empty:false};
 const db={query:async():Promise<[unknown,unknown]>=>[[{token_hash:hashPatternLinkToken(token),link_status:'active',revoked_at:null,card_id:'18',master_id:'4',fabric_id:state.changeScope?'6':'5',card_no:'G001-F005',deleted_at:state.deleted?'gone':null,card_active:state.active,master_active:1,fabric_active:1}],[]]};
 const app=express();app.use('/api/public/cards',createPublicCardRouter({db,
  load:async share=>{assert.equal(share.masterId,'4');assert.equal(share.fabricId,'5');return state.empty?null:{card,previews:new Map(state.related?[[ref,'asset']]:[])};},
  readDisplay:async()=>{if(state.withdraw)state.related=false;return {body:Buffer.from('derived'),byteSize:7,mime:'image/webp',etag:'x'};}
 }));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');const url='http://127.0.0.1:'+a.port+'/api/public/cards/'+token;
 try{
  const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.json()).card.colorways.length,2);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(url+'/images/'+ref.slice(8))).status,200);
  assert.equal((await fetch(url+'?masterId=7')).status,404);assert.equal((await fetch(url+'/images/'+'z'.repeat(43))).status,404);
  state.active=0;assert.equal((await (await fetch(url)).json()).available,false);assert.equal((await fetch(url+'/images/'+ref.slice(8))).status,404);state.active=1;
  state.withdraw=true;assert.equal((await fetch(url+'/images/'+ref.slice(8))).status,404);state.withdraw=false;state.related=true;
  state.empty=true;assert.equal((await (await fetch(url)).json()).available,false);state.empty=false;
  state.deleted=true;assert.equal((await fetch(url)).status,404);state.deleted=false;
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('card revocation occurring while image bytes are read suppresses the returned content',async()=>{
 let removed=false;
 const db={query:async():Promise<[unknown,unknown]>=>[removed?[]:[{token_hash:hashPatternLinkToken(token),link_status:'active',revoked_at:null,card_id:'18',master_id:'4',fabric_id:'5',card_no:'G001-F005',deleted_at:null,card_active:1,master_active:1,fabric_active:1}],[]]};
 const app=express();app.use(createPublicCardRouter({db,load:async()=>({card,previews:new Map([[ref,'asset']])}),readDisplay:async()=>{removed=true;return {body:Buffer.from('derived'),byteSize:7,mime:'image/webp',etag:'x'};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');try{assert.equal((await fetch('http://127.0.0.1:'+a.port+'/'+token+'/images/'+ref.slice(8))).status,404);}finally{await new Promise<void>(r=>server.close(()=>r()));}
});

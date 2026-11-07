import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCardReview,type ReviewEntry} from './sessionCardReview';
const card={id:'21',cardNo:'G0234-F002',masterId:'2',masterNo:'G0234',fabricId:'3',fabricNo:'F002',description:'真丝',composition:'100%S',weightValue:10,weightUnit:'mm' as const,widthValue:137,qrPayload:'Stable_card_token_123456789',isActive:true};
const entry:ReviewEntry={itemId:'11',productId:'12',productNo:'G0234-3-F002',version:'1',target:card,sources:[{cardId:'20',cardNo:'G0234-F001',retired:true},{cardId:'21',cardNo:'G0234-F002',retired:false}]};
test('retired and still-active historical sources both require review; same-number recreated cards compare identity',()=>{
 for(const old of [{cardId:'20',cardNo:'G0234-F001',retired:true},{cardId:'20',cardNo:card.cardNo,retired:true},{cardId:'20',cardNo:'G0234-F001',retired:false}]){
 const p=buildCardReview('1',[{...entry,sources:[old,...entry.sources.slice(1)]}],{},true);assert.equal(p.public.issues.length,1);assert.equal(p.public.cardCount,1);assert.equal(p.public.issues[0].currentCard?.cardNo,card.cardNo);assert(!JSON.stringify(p.public).includes(card.qrPayload));
 }
});
test('explicit confirmation suppresses old history without losing the selected subset; further changes invalidate it',()=>{
 const first=buildCardReview('1',[entry],{},true),confirmed={[entry.itemId]:first.fingerprints.get(entry.itemId)!};
 assert.equal(buildCardReview('1',[entry],confirmed,true).public.issues.length,0);
 assert.equal(buildCardReview('1',[{...entry,version:'2'}],confirmed,true).public.issues.length,1);
 assert.equal(buildCardReview('1',[{...entry,target:{...card,id:'22'}}],confirmed,true).public.issues.length,1);
 assert.equal(buildCardReview('1',[{...entry,target:null}],confirmed,true).public.issues[0].canUpdate,false);
});
test('clean selections export directly, missing sources require confirmation and unresolved cards never disappear',()=>{
 const p=buildCardReview('1',[{...entry,sources:entry.sources.slice(1)}],{},false);assert.equal(p.public.issues.length,0);assert.equal(p.cards.length,1);
 assert.equal(buildCardReview('1',[{...entry,sources:[]}],{},true).public.issues.length,1);
 const blocked=buildCardReview('1',[{...entry,target:null}],{},false);assert.equal(blocked.public.totalProducts,1);assert.equal(blocked.public.issues.length,1);assert.equal(blocked.public.canUpdate,false);
});

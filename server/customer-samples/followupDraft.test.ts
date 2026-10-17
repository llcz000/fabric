import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareSampleFollowup,SampleFollowupError} from './followupDraft';

const sessionId='41';
const selection=[
 {itemId:'81',productId:'18',removedAt:null},
 {itemId:'82',productId:'19',removedAt:null},
 {itemId:'83',productId:'20',removedAt:'2026-10-15T09:00:00Z'},
];
const entry=()=>({
 sessionId,contactedOn:'2026-10-17',customerConfirmed:true,feedback:'客户认可花型',
 outcome:'待客户内部确认价格',nextAction:'三天后再询问',nextFollowupOn:'2026-10-20',productIds:['18']
});
test('FOLLOW-01 prepares confirmed feedback and upcoming followup with only current selected product references',()=>{
 const raw=entry(),original=structuredClone(selection);
 const out=prepareSampleFollowup(raw,selection,{sessionId});
 assert.deepEqual(out,raw);
 assert.notStrictEqual(out,raw);
 assert.notStrictEqual(out.productIds,raw.productIds);
 assert.deepEqual(selection,original);
 assert.equal(Object.hasOwn(out,'documentId'),false,'follow-up never creates an order');
});
test('FOLLOW-01 can record a call without product refs or next appointment, and unknown confirmation remains null',()=>{
 const out=prepareSampleFollowup({sessionId,contactedOn:'2026-10-17',outcome:'已联系',productIds:[]},selection,{sessionId});
 assert.deepEqual(out,{sessionId,contactedOn:'2026-10-17',customerConfirmed:null,feedback:null,
  outcome:'已联系',nextAction:null,nextFollowupOn:null,productIds:[]});
});
test('FOLLOW-01 rejects cross-session, removed, fabricated, duplicate or malformed associated products',()=>{
 for(const productIds of [['20'],['99'],['18','18'],[18],['0'],['01'],['18446744073709551616'],null] as unknown[]){
  assert.throws(()=>prepareSampleFollowup({...entry(),productIds},selection,{sessionId}),SampleFollowupError);
 }
 assert.throws(()=>prepareSampleFollowup({...entry(),sessionId:'42'},selection,{sessionId}),SampleFollowupError);
 assert.throws(()=>prepareSampleFollowup(entry(),[{itemId:'81',productId:'18',removedAt:null},{itemId:'82',productId:'18',removedAt:null}],{sessionId}),SampleFollowupError);
});
test('FOLLOW-01 rejects invalid dates, next followup earlier than contact, and made-up confirmation',()=>{
 for(const date of ['2026-02-30','2026-10-17T00:00:00Z','2026-00-01',null]){
  assert.throws(()=>prepareSampleFollowup({...entry(),contactedOn:date},selection,{sessionId}),SampleFollowupError);
 }
 assert.throws(()=>prepareSampleFollowup({...entry(),nextFollowupOn:'2026-10-16'},selection,{sessionId}),SampleFollowupError);
 for(const v of ['true',1,'confirmed',undefined]){
  assert.throws(()=>prepareSampleFollowup({...entry(),customerConfirmed:v},selection,{sessionId}),SampleFollowupError);
 }
});
test('FOLLOW-01 rejects injected actor/order fields, control characters and overly long feedback',()=>{
 for(const patch of [{actorId:'9'},{documentId:'37'},{status:'shipped'},{feedback:'\u0000'},{outcome:'\nSECRET'},{outcome:''},
  {feedback:'x'.repeat(2001)},{nextAction:'a'.repeat(401)}]){
  assert.throws(()=>prepareSampleFollowup({...entry(),...patch},selection,{sessionId}),SampleFollowupError);
 }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {DocType,type CompanyProfile,type DocumentData} from '../../types';
import {fromV2DocumentRecord,toV2CreatePayload,toV2EditPayload} from './documentAdapter';
const profile={name:'现行公司资料',address:'现行地址',phone:'现行电话',defaultTerms:'现行条款'} as CompanyProfile;
const record={id:'27',ownerId:'7',orderNo:'XS-DOC',date:'2026-10-12',type:'bulk',receivingUnit:'旧客户',
 deposit:20,styleNo:'ST-22',issuer:'小王',receiver:'签收甲',receiverPhone:'13333333',receiverAddress:'仓库2',settled:true,
 displaySnapshot:{companyName:'历史公司',companyAddress:'历史地址',companyPhone:'历史电话',terms:'历史条款'},
 totalMeters:7,totalPieces:2,totalAmount:75,deductionMeters:0.5,
 items:[{id:'51',productId:'200',source:'catalog',snapshot:{weightUnit:'mm',productNo:'G027'},productNo:'G027',
 productName:'提花',colorNo:'2',composition:'棉/丝',weight:15.5,widthCm:150,meters:7,unitPrice:12.5,
 amount:81.25,remark:'保存的',pieceMeters:[3.5,3.5],deductionMeters:0.5}]};
test('P6-2b read API response renders frozen display/header and keeps stable ID/source',()=>{
 const d=fromV2DocumentRecord(record,profile);
 assert.equal(d.type,DocType.SALES);assert.equal(d.companyName,'历史公司');
 assert.equal(d.companyAddress,'历史地址');assert.equal(d.terms,'历史条款');
 assert.equal(d.styleNo,'ST-22');assert.equal(d.issuer,'小王');
 assert.equal(d.receiver,'签收甲');assert.equal(d.receiverAddress,'仓库2');assert.equal(d.settled,true);
 const row=d.items[0] as typeof d.items[0]&{rollNo:string;v2ProductId:string;v2SelectionChanged:boolean};
 assert.equal(row.id,'51');assert.equal(row.v2ProductId,'200');assert.equal(row.rollNo,'3.5, 3.5');
 assert.equal(row.v2SelectionChanged,false);
 assert.equal(d.totalAmount,75);
});
test('P6-2b historical nullable display falls back only to supplied company profile, never reassigns owner',()=>{
 const d=fromV2DocumentRecord({...record,displaySnapshot:null,items:[]},profile);
 assert.equal(d.companyName,'现行公司资料');
 assert.equal(d.terms,'现行条款');
});
test('P6-2b create and edit payload retain header fields and no computed totals',()=>{
 const d=fromV2DocumentRecord(record,profile);
 const input=toV2CreatePayload(d,'sales');
 for(const name of ['styleNo','issuer','receiver','receiverPhone','receiverAddress','settled','displaySnapshot'])
  assert(name in input,name);
 assert.deepEqual(input.displaySnapshot,record.displaySnapshot);
 const updated=toV2EditPayload(d,'sales',[]);
 assert.equal(updated.receiverPhone,'13333333');
 assert.equal(updated.settled,true);
 assert.deepEqual(updated.displaySnapshot,record.displaySnapshot);
 assert(!('ownerId' in input));
 assert(!('totalAmount' in updated));
});
test('P6-2b response validation rejects dangerous/unsupported server payload',()=>{
 assert.throws(()=>fromV2DocumentRecord({...record,items:'missing'},profile));
 assert.throws(()=>fromV2DocumentRecord({...record,type:'invalid'},profile));
});

test('DOC-05/07 read/edit mapping normalizes inapplicable fields and uses rounded deposit money',()=>{
 const sample=fromV2DocumentRecord({...record,type:'sample',deposit:20},profile);
 assert.equal(sample.deposit,0);assert.equal(sample.receivableAmount,75);assert.equal(sample.totalRolls,1);
 assert(!('deposit' in toV2EditPayload({...sample,deposit:50},'sales',[])));
 const deposit=fromV2DocumentRecord({...record,type:'deposit',totalAmount:0.01,deposit:50,settled:true},profile);
 assert.equal(deposit.totalRolls,0);assert.equal(deposit.settled,false);assert.equal(deposit.receivableAmount,0);
 assert.equal(toV2CreatePayload({...deposit,settled:true},'sales').settled,false);
 assert(!('settled' in toV2EditPayload({...deposit,settled:true},'sales',[])));
});

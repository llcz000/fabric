import assert from 'node:assert/strict';
import test from 'node:test';
import {DocType,type DocumentData} from '../../types';
import {toV2CreatePayload,toV2EditPayload,V2DraftMappingError} from './documentAdapter';
const doc={id:'new',docNo:'XS-20261012-001',date:'2026-10-12',customerName:'客户A',
 type:DocType.SALES,deposit:20,
 items:[{id:'temp-1',itemNo:'G0112',colorNo:'2',productName:'棉麻',
  rollNo:'3.5, 3.5',width:'150',meters:7,price:12.5,amount:81.25,deductionMeters:0.5,
  remark:'保证原值',v2ProductId:'777',v2SourceKind:'catalog',v2SelectionChanged:true}],
 totalAmount:81.25,totalMeters:7,receivableAmount:61.25} as unknown as DocumentData;
test('P6 V2 create adapter emits stable product selection, sales rolls/deductions, no spoofed subtotal/owner',()=>{
 const p=toV2CreatePayload(doc,'sales');
 assert.deepEqual(p,{orderNo:doc.docNo,date:doc.date,receivingUnit:doc.customerName,
  type:'bulk',deposit:20,
  styleNo:'',issuer:'',receiver:'',receiverPhone:'',receiverAddress:'',settled:false,
  displaySnapshot:{companyName:'',companyAddress:'',companyPhone:'',terms:''},
  items:[{selection:{productId:'777'},
   fields:{meters:7,unitPrice:12.5,remark:'保证原值',deductionMeters:0.5,pieceMeters:[3.5,3.5]}}]});
 assert(!JSON.stringify(p).includes('totalAmount'));
});
test('P6 V2 edit adapter retains stable numeric line ID and only reselects on changed identity',()=>{
 const current={...doc,id:'101',items:[{...doc.items[0],id:'55',v2SelectionChanged:false}]};
 const edit=toV2EditPayload(current,'sales',[]);
 assert.equal(edit.items[0].id,'55');
 assert(!('selection' in edit.items[0]),'Unchanged associated product may be disabled');
 const changed=toV2EditPayload({...current,items:[{...current.items[0],v2SelectionChanged:true}]} as unknown as DocumentData,'sales',[]);
 assert.deepEqual(changed.items[0].selection,{productId:'777'});
 assert.deepEqual(changed.removeIds,[]);
});
test('P6 V2 cannot copy old unlinked/manual row as a newly created sales line',()=>{
 const old={...doc,items:[{...doc.items[0],v2ProductId:undefined,v2SourceKind:null}]};
 assert.throws(()=>toV2CreatePayload(old,'sales'),V2DraftMappingError);
 assert.throws(()=>toV2CreatePayload({...doc,items:[{...doc.items[0],rollNo:'one bad'}]},'sales'),V2DraftMappingError);
 const inserted=toV2EditPayload({...doc,items:[{...doc.items[0],id:'new-1'}]},'sales',[]);
 assert(!('id' in inserted.items[0]));
 assert.deepEqual(inserted.items[0].selection,{productId:'777'});
});
test('P6 V2 manual requires explicit administrator and new line; reject hidden role escalation',()=>{
 const hand={...doc,type:DocType.SAMPLE,items:[{...doc.items[0],id:'temp2',
  v2ProductId:undefined,v2SourceKind:'manual',itemNo:'H101',productName:'手工样布',
  composition:'棉',weight:'120',width:'150'}]};
 assert.throws(()=>toV2CreatePayload(hand,'sales'),V2DraftMappingError);
 assert.deepEqual(toV2CreatePayload(hand,'admin').items[0].manual,{productNo:'H101',
  productName:'手工样布',composition:'棉',weight:120,width:150,colorNo:'2'});
});

test('DOC-06 adapter preserves every numeric piece beyond the former 200-slot cap',()=>{
 const many={...doc,items:[{...doc.items[0],meters:235,rollNo:Array.from({length:235},()=>1).join(', ')}]};
 const payload=toV2CreatePayload(many,'sales');
 assert.equal(payload.items[0].fields.pieceMeters?.length,235);assert.equal(payload.items[0].fields.meters,235);
});

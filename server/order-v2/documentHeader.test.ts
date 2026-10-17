import assert from 'node:assert/strict';
import test from 'node:test';
import {validateV2DocumentCreate,validateV2DocumentEdit,DocumentWriteError} from './documents';
const h={styleNo:'ST001',issuer:'业务员A',receiver:'客户B',receiverPhone:'13900000000',
 receiverAddress:'浙江绍兴柯桥区',settled:true,
 displaySnapshot:{companyName:'原创公司',companyAddress:'绍兴',companyPhone:'0575',terms:'具体签约条款'}};
const base={orderNo:'YB-20261012-001',date:'2026-10-12',receivingUnit:'客户',
 type:'sample',deposit:0,items:[{fields:{meters:1,unitPrice:12},selection:{productId:'1'}}]};
test('P6 header create accepts safe optional contact/signature/payment and frozen company display',()=>{
 const data=validateV2DocumentCreate({...base,...h});
 for(const [key,value] of Object.entries(h))assert.deepEqual((data as unknown as Record<string,unknown>)[key],value,key);
});
test('P6 header editing has explicit partial update, null display reset allowed, but cannot spoof immutable document id/type',()=>{
 const edited=validateV2DocumentEdit({items:[],removeIds:[],...h});
 for(const [key,value] of Object.entries(h))assert.deepEqual((edited as unknown as Record<string,unknown>)[key],value,key);
 assert.equal(validateV2DocumentEdit({items:[],removeIds:[],displaySnapshot:null}).displaySnapshot,null);
 for(const evil of [{items:[],removeIds:[],template_type:'bulk'},
  {items:[],removeIds:[],createdByUserId:'3'}])
  assert.throws(()=>validateV2DocumentEdit(evil),DocumentWriteError);
});

test('DOC-01/03 editable number, date and customer are validated independently of stable document ID/type',()=>{
 const data=validateV2DocumentEdit({items:[],removeIds:[],orderNo:'XS-NEW',date:'2026-10-17',receivingUnit:'新客户'});
 assert.equal(data.orderNo,'XS-NEW');assert.equal(data.date,'2026-10-17');assert.equal(data.receivingUnit,'新客户');
 for(const fields of [{date:'2026-02-30'},{orderNo:''},{receivingUnit:''}])assert.throws(()=>validateV2DocumentEdit({items:[],removeIds:[],...fields}));
});
test('P6 header rejects unknown keys, excessive length, invalid types, unsafe presentation snapshot',()=>{
 for(const bad of [
  {...base,issuer:'x'.repeat(101)},
  {...base,receiverPhone:'x'.repeat(101)},
  {...base,receiverAddress:'x'.repeat(501)},
  {...base,settled:'yes'},
  {...base,displaySnapshot:{...h.displaySnapshot,token:'secret'}},
  {...base,displaySnapshot:{...h.displaySnapshot,companyName:'x'.repeat(256)}},
  {...base,displaySnapshot:{companyName:'abc',companyAddress:4}},
  {...base,displaySnapshot:[1,2]},
  {...base,displaySnapshot:{companyName:'x',terms:'x'.repeat(12001)}}
 ])assert.throws(()=>validateV2DocumentCreate(bad),DocumentWriteError);
});

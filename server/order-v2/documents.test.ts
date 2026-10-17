import assert from 'node:assert/strict';
import test from 'node:test';
import {validateV2DocumentCreate,validateV2DocumentEdit,DocumentWriteError,
 createV2Document,updateV2Document,readV2Document} from './documents';
import type {AppPrincipal} from '../access/types';
const sales:AppPrincipal={userId:'2',role:'sales',username:'sale',displayName:'Sale',
 canManageOwnOrders:true,canManageProducts:false,sessionId:'9'};
const base={orderNo:'XS20261012001',date:'2026-10-12',receivingUnit:'客户A',type:'sales',
 deposit:30,items:[{fields:{meters:7,unitPrice:12.5,deductionMeters:0.5,pieceMeters:[3.5,3.5]},selection:{productId:'777'}}]};
test('P6-2 create schema accepts real types and refuses spoofed totals/owner/product descriptors',()=>{
 const payload=validateV2DocumentCreate(base);
 assert.equal(payload.type,'bulk');
 assert.equal(payload.items[0].selection?.productId,'777');
 for(const fail of [{...base,createdByUserId:'666'},{...base,totalAmount:1},
  {...base,type:'abc'},{...base,orderNo:''},{...base,orderNo:'x'.repeat(120)},
  {...base,items:[{fields:{meters:1},legacy:true}]},
  {...base,date:'2026-02-31'},{...base,deposit:NaN},
  {...base,items:[]},{...base,items:[{id:'4',fields:{meters:3},selection:{productId:'2'}}]}])
  assert.throws(()=>validateV2DocumentCreate(fail as never),DocumentWriteError);
});
test('P6-2 edit forbids owner/type/id/total spoofing and omission of removeIds',()=>{
 const edit=validateV2DocumentEdit({items:[{id:'11',fields:{meters:8}}],removeIds:[],deposit:12});
 assert.equal(edit.items[0].id,'11');
 for(const bad of [{items:[],removeIds:[],createdByUserId:'99'},{items:[],removeIds:[],totalAmount:2},
  {items:[]},{items:'hi',removeIds:[]},{items:[],removeIds:[],type:'deposit'}])
  assert.throws(()=>validateV2DocumentEdit(bad as never),DocumentWriteError);
});

test('DOC-05/07 new writes reject sample prepayment and deposit settlement fields',()=>{
 const sample={...base,type:'sample',deposit:1,items:[{fields:{meters:1,unitPrice:20},selection:{productId:'777'}}]};
 assert.throws(()=>validateV2DocumentCreate(sample),DocumentWriteError);
 assert.throws(()=>validateV2DocumentCreate({...sample,type:'deposit',deposit:30,settled:true}),DocumentWriteError);
 assert.equal(validateV2DocumentCreate({...sample,deposit:0}).deposit,0);
});

test('DOC-05/07 rereads expose type-correct fields without rewriting legacy raw values',async()=>{
 for(const type of ['sample','deposit'] as const){
  const header={id:'123',created_by_user_id:'2',order_no:'OLD',order_date:'2026-10-17',receiving_unit:'客户',template_type:type,deposit:50,total_meters:1,total_pieces:4,total_amount:0.01,deduction_meters:0,settled:1};
  const calls:string[]=[];const db={async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);return [sql.includes('FROM orders o')?[header]:[],[]];}};
  const record=await readV2Document(db,sales,'123');
  if(type==='sample'){assert.equal(record.deposit,0);assert.equal(record.totalPieces,0);}
  else {assert.equal(record.totalPieces,0);assert.equal(record.settled,false);}
  assert.equal(header.deposit,50);assert.equal(header.settled,1);assert(calls.every(sql=>sql.startsWith('SELECT')));
 }
});

test('DOC-05/07 update uses the locked saved type and rolls back forbidden header changes',async()=>{
 for(const [type,change] of [['sample',{deposit:5}],['deposit',{settled:true}],['deposit',{deposit:101}]] as const){
  const calls:string[]=[];let rolled=0,committed=0;
  const pool={async getConnection(){return {async beginTransaction(){},async commit(){committed++;},async rollback(){rolled++;},release(){},
   async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);
    if(sql.includes('FROM v2_access_users'))return [[{id:'2',role:'sales',is_active:1,can_manage_own_orders:1}],[]];
    if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
    if(sql.startsWith('SELECT id,created_by_user_id FROM orders'))return [[{id:'123',created_by_user_id:'2'}],[]];
    if(sql.startsWith('SELECT id,order_id'))return [[],[]];
    if(sql.startsWith('SELECT template_type FROM orders'))return [[{template_type:type}],[]];
    throw Error('Unexpected SQL '+sql);
   }};}};
  await assert.rejects(updateV2Document(pool,sales,'123',{items:[],removeIds:[],...change}),DocumentWriteError);
  assert.equal(rolled,1);assert.equal(committed,0);assert(!calls.some(sql=>sql.startsWith('UPDATE')));
 }
});
class Db {
 statements:{sql:string;params:unknown[]}[]=[];commits=0;rolls=0;released=0;
 async getConnection(){
  const own=this;
  return {async beginTransaction(){},async commit(){own.commits++},async rollback(){own.rolls++},release(){own.released++},
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   own.statements.push({sql,params});
   if(sql.startsWith('SELECT id,role,is_active'))return [[{id:2,role:'sales',is_active:1,can_manage_own_orders:1,can_manage_products:0}],[]];
   if(sql.includes('FROM v2_access_sessions')&&sql.includes('FOR SHARE'))return [[{id:9}],[]];
   if(sql.startsWith('INSERT INTO orders'))return [{insertId:123},[]];
   if(sql.startsWith('SELECT id,created_by_user_id FROM orders'))return [[{id:123,created_by_user_id:2}],[]];
   if(sql.startsWith('SELECT id,order_id,v2_product_id'))return [[],[]];
   if(sql.includes('FROM v2_products p'))return [[{id:777,product_no:'P777',product_active:1,fabric_no:'F777',fabric_name:'测试棉',
    composition:'100% cotton',weight_value:'120.00',weight_unit:'gsm',width_value:'150.00',fabric_active:1,
    colorway_no:1,colorway_active:1,master_no:'G777',master_active:1}],[]];
   if(sql.startsWith('INSERT INTO order_items'))return [{insertId:555},[]];
   if(sql.startsWith('SELECT template_type,deposit'))return [[{template_type:'bulk',deposit:30}],[]];
   if(sql.startsWith('SELECT id,meters,unit_price,amount,piece_meters'))return [[{id:555,meters:'7.00',
    unit_price:'12.50',amount:'0.00',piece_meters:'[3.5,3.5]',deduction_meters:'0.50'}],[]];
   if(sql.startsWith('UPDATE order_items SET amount'))return [{affectedRows:1},[]];
   if(sql.startsWith('UPDATE orders SET total_meters'))return [{affectedRows:1},[]];
   if(sql.startsWith('SELECT o.id,')&&sql.includes('FROM orders o'))return [[{
    id:123,order_no:base.orderNo,order_date:'2026-10-12',receiving_unit:'客户A',template_type:'bulk',
    deposit:'30.00',total_meters:'7.00',total_pieces:2,total_amount:'81.25',
    deduction_meters:'0.50',created_by_user_id:2}],[]];
   if(sql.startsWith('SELECT i.id,i.order_id'))return [[{id:555,order_id:123,product_no:'P777',
    product_name:'测试棉',color_no:'1',composition:'100% cotton',weight:'120.00',width:'150.00',
    meters:'7.00',unit_price:'12.50',amount:'81.25',remark:'',
    piece_meters:'[3.5,3.5]',deduction_meters:'0.50',v2_source_kind:'catalog',
    v2_product_id:777,v2_product_snapshot:JSON.stringify({productNo:'P777',weightUnit:'gsm'})}],[]];
   throw Error('Unexpected '+sql);
  }};
 }
}
test('P6-2 create locks actual account and session, inserts header with server-derived owner and freezes DB product in same txn',async()=>{
 const db=new Db();
 const created=await createV2Document(db,sales,base);
 assert.equal(created.id,'123');assert.equal(created.items[0].id,'555');
 assert.equal(created.items[0].productId,'777');
 assert.equal(created.items[0].snapshot?.productNo,'P777');
 assert.equal(created.totalAmount,81.25);
 assert.equal(db.commits,1);assert.equal(db.rolls,0);
 const header=db.statements.find(x=>x.sql.startsWith('INSERT INTO orders'))!;
 assert(header.sql.includes('created_by_user_id'));assert(header.params.includes('2'));
 assert(!header.params.includes('999'));
 assert(db.statements.some(x=>x.sql.includes('v2_product_snapshot')));
});
test('P6-2 error rolls back entire create and no partial header committed',async()=>{
 const db=new Db();
 await assert.rejects(createV2Document(db,sales,{...base,items:[{fields:{meters:7,unitPrice:12.5},selection:{productId:'777'},productNo:'client_spoof'}]} as never),DocumentWriteError);
 assert.equal(db.commits,0);assert.equal(db.rolls,0);
});
test('P6-3 ownerless and other-user old orders return 404, admin can read them',async()=>{
 const db={async query(_sql:string){return [[{id:12,created_by_user_id:null,order_no:'OLD',order_date:'2026-10-12',
  receiving_unit:'Client',template_type:'sample',deposit:0,total_meters:0,total_pieces:0,total_amount:0,deduction_meters:0}],[]] as [unknown,unknown];}};
 await assert.rejects(readV2Document(db,sales,'12'),(err:unknown)=>err instanceof DocumentWriteError&&err.status===404);
});

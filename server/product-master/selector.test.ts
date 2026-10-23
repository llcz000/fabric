import assert from 'node:assert/strict';
import test from 'node:test';
import {searchSelectableProducts,SelectorQueryError,parseSelectorQuery} from './selector';
type Row=Record<string,unknown>;
class DB {
 sql:{q:string;params:unknown[]}[]=[];data:Row[]=[];
 async query(q:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.sql.push({q,params});
  if(q.includes('COUNT(*) AS total'))return [[{total:11}],[]];
  if(q.includes('FROM v2_products p'))return [this.data,[]];
  throw Error('Unexpected query');
 }
}
test('P6-1 parses independent searchable filters, safe default and bounded pagination',()=>{
 assert.deepEqual(parseSelectorQuery({}),{productNo:'',fabricName:'',limit:20,offset:0});
 assert.deepEqual(parseSelectorQuery({productNo:' G011 ',fabricName:' 棉 ',limit:'8',offset:'16'}),
  {productNo:'G011',fabricName:'棉',limit:8,offset:16});
 for(const bad of [{limit:'0'},{limit:'101'},{limit:'3.3'},{offset:'-1'},{offset:'1000001'},
   {productNo:4},{productNo:'a'.repeat(161)},{unexpected:'x'},{limit:['5','6']}])
  assert.throws(()=>parseSelectorQuery(bad),SelectorQueryError);
});
test('P6-1 enforces all four active joins AND two independently escaped LIKE terms, stable page',async()=>{
 const db=new DB();db.data=[{id:'9',product_no:'G0112',fabric_name:'纯棉',
 master_no:'G011',colorway_no:2,composition:null,weight_value:null,weight_unit:null,width_value:null,pattern_image_asset_id:null}];
 const found=await searchSelectableProducts(db,{productNo:'A%_',fabricName:'棉\\A',limit:10,offset:20});
 assert.equal(found.total,11);assert.equal(found.items.length,1);
 assert.equal(found.items[0].weight,null);assert.equal(found.items[0].widthCm,null);
 const q=db.sql[0];
 assert.match(q.q,/p.is_active=1/);assert.match(q.q,/f.is_active=1/);
 assert.match(q.q,/c.is_active=1/);assert.match(q.q,/m.is_active=1/);
 assert.match(q.q,/p.product_no LIKE \? ESCAPE/);assert.match(q.q,/f.fabric_name LIKE \? ESCAPE/);
 assert.deepEqual(q.params,['%A\\%\\_%','%棉\\\\A%']);
 assert.match(db.sql[1].q,/ORDER BY p\.product_no ASC, p\.id ASC LIMIT \? OFFSET \?/);
 assert.deepEqual(db.sql[1].params,['%A\\%\\_%','%棉\\\\A%',10,20]);
});
test('P6-1 selector returns only necessary DTO fields, never raw COS keys',async()=>{
 const db=new DB();db.data=[{id:'9007199254740993',product_no:'P1',fabric_name:'纯棉',
  master_no:'G0',colorway_no:3,composition:'棉',weight_value:'123.500',weight_unit:'gsm',
  width_value:'150.00',pattern_image_asset_id:'asset-guid',cos_key:'SECRET'}];
 const value=await searchSelectableProducts(db,{productNo:'',fabricName:'',offset:0,limit:20});
 assert.deepEqual(Object.keys(value.items[0]).sort(),['colorwayNo','composition','fabricName','id','masterNo','patternImageAssetId','productNo','weight','weightUnit','widthCm'].sort());
 assert.equal(value.items[0].id,'9007199254740993');
 assert.equal(value.items[0].weight,123.5);
 assert(!JSON.stringify(value).includes('SECRET'));
});

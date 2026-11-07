import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {listSampleCards} from './cardLibrary';
test('card list can batch all colorways for exactly its paginated cards without fetching image originals',async()=>{
 const token='x'.repeat(32),queries:string[]=[];
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{queries.push(sql);
  if(sql.includes('COUNT(*)'))return [[{total:50}],[]];
  if(sql.includes('SELECT sc.id AS card_id')){assert.deepEqual(args,['12']);assert.match(sql,/cw.master_id=sc.master_id/);assert.match(sql,/p.fabric_id=sc.fabric_id/);assert.match(sql,/ORDER BY sc.id,cw.colorway_no/);return [[{card_id:'12',product_id:'8',colorway_no:1,pattern_image_asset_id:null},{card_id:'12',product_id:'9',colorway_no:2,pattern_image_asset_id:'dddddddd-4444-4444-8444-444444444444'}],[]];}
  return [[{id:'12',master_id:'41',master_no:'G0886',fabric_id:'23',fabric_no:'F018',card_no:'G0886-F018',fabric_name:'雪纺',composition:null,weight_value:null,weight_unit:null,width_value:null,qr_payload:token,token_hash:createHash('sha256').update(token).digest('hex'),is_active:1}],[]];
 }};
 const result=await listSampleCards(db,{limit:1,offset:20,includeColorways:true});assert.deepEqual(result.items[0].colorways?.map(c=>[c.productId,c.colorwayNo]),[['8',1],['9',2]]);assert.equal(queries.length,3);assert.equal(result.total,50);
});

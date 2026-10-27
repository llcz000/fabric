import assert from 'node:assert/strict';
import test from 'node:test';
import {inventoryProductCards,migrateProductCards} from './productCardBackfill';
const target={database:'test_fabric',serverUuid:'12345678-1234-1234-1234-123456789abc'};
class Db{
 cards:any[]=[];tokens:any[]=[];queries:string[]=[];applied=false;plan='';fail=false;released=false;
 async query(sql:string,args:unknown[]=[]):Promise<[any,any]>{
  this.queries.push(sql);
  if(sql.includes('DATABASE()'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];
  if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];
  if(sql.includes('RELEASE_LOCK'))return [[{released:1}],[]];
  if(sql.startsWith('SELECT')&&sql.includes('fabric_v2_migration_ledger'))return [this.applied?[{plan_sha256:this.plan,applied_at:'now'}]:[],[]];
  if(sql.startsWith('INSERT INTO fabric_v2_migration_ledger')){this.applied=true;this.plan=String(args[1]);return [{affectedRows:1},[]];}
  if(sql.startsWith('SELECT c.master_id,p.fabric_id,COUNT'))return [[{master_id:'1',fabric_id:'2',product_count:2,card_id:this.cards[0]?.id??null}],[]];
  if(sql.includes('FROM pattern_masters WHERE'))return [[{id:'1',master_no:'G1',is_active:1}],[]];
  if(sql.includes('FROM v2_fabrics WHERE'))return [[{id:'2',fabric_no:'F2',is_active:1}],[]];
  if(sql.startsWith('SELECT p.id FROM v2_products'))return [[{id:'3'},{id:'4'}],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM sample_cards c'))return [this.cards,[]];
  if(sql.startsWith('INSERT INTO sample_cards')){this.cards.push({id:'5',master_id:'1',fabric_id:'2',master_no:'G1',fabric_no:'F2',card_no:args[2],qr_payload:args[3],is_active:1,fabric_name:'fabric',composition:null,weight_value:null,weight_unit:null,width_value:null});return [{insertId:'5'},[]];}
  if(sql.startsWith('INSERT INTO sample_card_tokens')){if(this.fail)throw Error('token write failed');this.tokens.push(args);this.cards[0].token_hash=args[1];return [{affectedRows:1},[]];}
  throw Error('Unexpected SQL '+sql);
 }
 async getConnection(){const snapshot=structuredClone({cards:this.cards,tokens:this.tokens,applied:this.applied});return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{Object.assign(this,snapshot);},release:()=>{this.released=true;},destroy:()=>{this.released=true;}};}
}
test('product card inventory is read-only and groups existing products without changing them',async()=>{
 const db=new Db(),result=await inventoryProductCards(db);
 assert.equal(result.missing,1);assert.equal(result.products,2);assert.equal(result.groups.length,1);
 assert(db.queries.every(q=>q.startsWith('SELECT')));assert.equal(db.cards.length,0);
});
test('backfill requires backup and exact target before writes; token failure rolls back the entire supplement',async()=>{
 const db=new Db();await assert.rejects(migrateProductCards(db,target,'bad'),/backup/i);assert.equal(db.queries.length,0);
 await assert.rejects(migrateProductCards(db,{...target,database:'wrong'},'a'.repeat(64)),/target/i);assert.equal(db.cards.length,0);
 db.fail=true;await assert.rejects(migrateProductCards(db,target,'a'.repeat(64)),/token write failed/);
 assert.equal(db.cards.length,0);assert.equal(db.tokens.length,0);assert.equal(db.applied,false);assert(db.released);
});
test('backfill fills a missing group once and repeated execution preserves the same QR and product set',async()=>{
 const db=new Db(),first=await migrateProductCards(db,target,'a'.repeat(64));assert.equal(first.created,1);
 const qr=db.cards[0].qr_payload;const second=await migrateProductCards(db,target,'a'.repeat(64));assert(second.alreadyApplied);
 assert.equal(db.cards.length,1);assert.equal(db.cards[0].qr_payload,qr);assert.equal((await inventoryProductCards(db)).missing,0);
 assert(!db.queries.some(q=>/^(UPDATE|DELETE|INSERT INTO) v2_products/.test(q)));
});
test('an applied ledger still supplements a late product group from the old backend',async()=>{
 const seed=new Db(),first=await migrateProductCards(seed,target,'a'.repeat(64));
 const late=new Db();late.applied=true;late.plan=first.planSha256;
 const result=await migrateProductCards(late,target,'a'.repeat(64));
 assert(result.alreadyApplied);assert.equal(result.created,1);assert.equal((await inventoryProductCards(late)).missing,0);
});

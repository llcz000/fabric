import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import type {AppPrincipal} from '../access/types';
import {createSampleCard,retireSampleCard,confirmSampleCardReprinted,listSampleCards,getSelectedSampleCards,SampleCardError} from './cardLibrary';
type Row=Record<string,unknown>;
const actor:AppPrincipal={userId:'6',sessionId:'1',username:'sales',displayName:'Sales',role:'sales',canManageOwnOrders:false,canManageProducts:false};
const allow=()=>true;
class Fixture {
 user:Row|null={id:'6',role:'sales',is_active:1,can_manage_products:0,can_manage_own_orders:0};
 login=true; master:Row|null={id:'41',master_no:'001234',is_active:1};
 fabric:Row|null={id:'23',fabric_no:'F018',fabric_name:'绸',composition:null,weight_value:'16',weight_unit:'mm',width_value:null,is_active:1};
 cards:Row[]=[];tokens:Row[]=[];queries:{sql:string;args:unknown[]}[]=[];
 rollbacks=0;releases=0;failure:string|null=null;duplicate=false;reads:Row[]|null=null;
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  this.queries.push({sql,args});
  if(sql.includes('FROM v2_access_users'))return [this.user?[this.user]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.login?[{id:'1'}]:[],[]];
  if(sql.includes('FROM pattern_masters')&&!sql.includes('JOIN'))return [this.master?[this.master]:[],[]];
  if(sql.includes('FROM v2_fabrics')&&!sql.includes('JOIN'))return [this.fabric?[this.fabric]:[],[]];
  if(sql.startsWith('SELECT master_id,fabric_id FROM sample_cards WHERE id=?'))return [this.cards.filter(x=>x.id===args[0]).map(x=>({master_id:x.master_id,fabric_id:x.fabric_id})),[]];
  if(sql.startsWith('SELECT c.reprint_revision,c.printed_revision,c.deleted_at,c.master_id,c.fabric_id FROM sample_cards c WHERE c.id=?'))return [this.cards.filter(x=>x.id===args[0]),[]];
  if(sql.startsWith('UPDATE sample_cards SET printed_revision=')){
   const c=this.cards.find(x=>x.id===args[0]&&x.deleted_at==null&&String(x.reprint_revision)===args[1]);
   if(!c)return [{affectedRows:0},[]];c.printed_revision=c.reprint_revision;return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE sample_cards SET deleted_at=')){
   const row=this.cards.find(x=>x.id===args[0]&&x.deleted_at==null);
   if(!row)return [{affectedRows:0},[]];row.deleted_at=new Date().toISOString();row.is_active=0;
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('SELECT token_hash,revoked_at FROM sample_card_tokens WHERE card_id=?'))return [this.tokens.filter(t=>t.card_id===args[0]),[]];
  if(sql.startsWith('UPDATE sample_card_tokens SET revoked_at=')){
   if(this.failure==='revoke')throw Error('synthetic revoke failure');
   const row=this.tokens.find(x=>x.card_id===args[0]&&x.revoked_at==null);
   if(!row)return [{affectedRows:0},[]];row.revoked_at=new Date().toISOString();return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO sample_cards')){
   if(this.duplicate){this.duplicate=false;this.cards.push({id:'12',master_id:args[0],fabric_id:args[1],card_no:args[2],qr_payload:'existingStablePhysicalCardToken_12345',is_active:1});this.tokens.push({card_id:'12',token_hash:createHash('sha256').update('existingStablePhysicalCardToken_12345').digest('hex')});throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});}
   this.cards.push({id:String(this.cards.length+12),master_no:this.master!.master_no,master_id:args[0],fabric_id:args[1],card_no:args[2],qr_payload:args[3],is_active:1,reprint_revision:'0',printed_revision:'0'});return [{insertId:this.cards.at(-1)!.id},[]];
  }
  if(sql.startsWith('INSERT INTO sample_card_tokens')){
   if(this.failure==='token')throw Error('synthetic token failure');
   this.tokens.push({card_id:args[0],token_hash:args[1]});return [{insertId:this.tokens.length},[]];
  }
  if(sql.includes('FROM sample_cards c')){
   let data:Row[]=this.reads??this.cards.map(c=>({...c,master_no:c.master_no??this.master!.master_no,fabric_no:this.fabric!.fabric_no,fabric_name:this.fabric!.fabric_name,composition:this.fabric!.composition,weight_value:this.fabric!.weight_value,weight_unit:this.fabric!.weight_unit,width_value:this.fabric!.width_value,token_hash:this.tokens.find(t=>t.card_id===c.id&&t.revoked_at==null)?.token_hash}));
   if(sql.includes('c.deleted_at IS NULL'))data=data.filter(c=>c.deleted_at==null);
   if(sql.includes('c.master_id=? AND c.fabric_id=?'))data=data.filter(c=>c.master_id===args[0]&&c.fabric_id===args[1]);
   if(sql.includes('c.id=?'))data=data.filter(c=>c.id===args[0]);
   if(sql.includes('c.id IN'))data=data.filter(c=>args.includes(c.id));
   if(sql.includes('COUNT(*)'))return [[{total:data.length}],[]];
   if(sql.includes('LIMIT ? OFFSET ?'))data=data.slice(Number(args.at(-1)),Number(args.at(-1))+Number(args.at(-2)));
   return [data,[]];
  }
  throw Error('Unexpected SQL '+sql);
 }
 async getConnection(){
  const db=this;let cards:Row[]=[],tokens:Row[]=[];
  return {query:db.query.bind(db),async beginTransaction(){cards=structuredClone(db.cards);tokens=structuredClone(db.tokens);},async commit(){},async rollback(){db.rollbacks++;db.cards=cards;db.tokens=tokens;},release(){db.releases++;}};
 }
}
const rejected=(status:number)=>(e:unknown)=>e instanceof SampleCardError&&e.status===status;
test('AC-87/89/94 create persists one random payload with matching scan hash, preserves IDs, units and duplicate code',async()=>{
 const db=new Fixture();
 const first=await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 assert.equal(first.created,true);assert.equal(first.card.cardNo,'001234-F018');
 assert.equal(first.card.description,'绸');assert.equal(first.card.weightValue,16);assert.equal(first.card.weightUnit,'mm');assert.equal(first.card.widthValue,null);
 assert.match(first.card.qrPayload,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(db.tokens[0].token_hash,createHash('sha256').update(first.card.qrPayload).digest('hex'));
 db.fabric!.fabric_name='新绸';
 const same=await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 assert.equal(same.created,false);assert.equal(same.card.qrPayload,first.card.qrPayload);assert.equal(same.card.description,'新绸');
 assert.equal(db.cards.length,1);assert.equal(db.tokens.length,1);
 assert.match(db.queries.find(q=>q.sql.includes('FROM pattern_masters'))!.sql,/FOR UPDATE/);
 assert.match(db.queries.find(q=>q.sql.includes('FROM v2_fabrics'))!.sql,/FOR UPDATE/);
});
test('AC-96 B2-5 retire revokes old token; archived card never exports; recreating SAME combination uses fresh ID/token and preserves old row',async()=>{
 const db=new Fixture();const first=(await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow)).card;
 await assert.rejects(retireSampleCard(db,actor,first.id),rejected(403));
 const retired=await retireSampleCard(db,actor,first.id,allow);assert.deepEqual(retired,{id:first.id,retired:true});
 assert.equal(db.cards[0].is_active,0);assert(db.cards[0].deleted_at);
 assert(db.tokens[0].revoked_at);
 assert.equal((await listSampleCards(db)).total,0);
 await assert.rejects(getSelectedSampleCards(db,[first.id]),rejected(404));
 await assert.rejects(retireSampleCard(db,actor,first.id,allow),rejected(404));
 const second=(await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow)).card;
 assert.equal(first.cardNo,second.cardNo);assert.notEqual(first.id,second.id);assert.notEqual(first.qrPayload,second.qrPayload);
 assert.equal(db.cards.length,2);assert.equal(db.tokens.length,2);
 assert(db.tokens[0].revoked_at);assert.equal(db.tokens[1].revoked_at,undefined);
 assert.equal((await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow)).created,false);
 assert.equal((await listSampleCards(db)).total,1);
 assert(db.queries.find(x=>x.sql.startsWith('UPDATE sample_cards SET deleted_at=')));
});
test('AC-96 B2-5 token revoke failure rolls back retirement and releases transaction, invalid/unauthorized ID cannot touch business rows',async()=>{
 const db=new Fixture();const first=(await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow)).card;
 db.failure='revoke';const before=db.rollbacks;
 await assert.rejects(retireSampleCard(db,actor,first.id,allow),/synthetic revoke failure/);
 assert.equal(db.rollbacks,before+1);assert.equal(db.cards[0].deleted_at,undefined);assert.equal(db.tokens[0].revoked_at,undefined);
 const recent=db.queries.filter(q=>/FROM pattern_masters|FROM v2_fabrics|FROM sample_cards|UPDATE sample_cards|UPDATE sample_card_tokens/.test(q.sql)).slice(-5);
 assert.match(recent.map(x=>x.sql).join(' '),/pattern_masters.*v2_fabrics.*sample_cards.*UPDATE sample_card_tokens/s);
 for(const invalid of ['0','18446744073709551616','abc'])await assert.rejects(retireSampleCard(db,actor,invalid,allow),rejected(400));
 db.user!.is_active=0;await assert.rejects(retireSampleCard(db,actor,first.id,allow),rejected(401));
 assert.equal(db.cards[0].deleted_at,undefined);
});
test('AC-98/99 B2-5 list exposes pending reprint revision; successfully acknowledged card no longer warns',async()=>{
 const db=new Fixture(),first=(await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow)).card;
 db.cards[0].reprint_revision='7';db.cards[0].printed_revision='5';
 const pending=(await listSampleCards(db)).items[0];
 assert.equal(pending.id,first.id);assert.equal(pending.needsReprint,true);assert.equal(pending.reprintRevision,'7');
 await confirmSampleCardReprinted(db,actor,first.id,'7',allow);
 const refreshed=(await listSampleCards(db)).items[0];
 assert.equal(refreshed.needsReprint,false);assert.equal(refreshed.reprintRevision,'7');
 assert.equal(refreshed.qrPayload,first.qrPayload);
});
test('AC-98 B2-5 pending-only list filters in SQL BEFORE pagination and count',async()=>{
 const db=new Fixture();await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 await listSampleCards(db,{query:'绸',limit:20,offset:0,needsReprint:true});
 const count=db.queries.find(x=>x.sql.includes('COUNT(*)'))!;
 assert.match(count.sql,/c\.reprint_revision>c\.printed_revision/);
 assert.match(count.sql,/c\.deleted_at IS NULL/);
 await assert.rejects(listSampleCards(db,{needsReprint:'true' as never}),rejected(400));
});
test('AC-99 B2-5 reprint confirmation refuses stale revision after a concurrent fabric change, and cannot confirm retired cards',async()=>{
 const db=new Fixture(),first=(await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow)).card;
 db.cards[0].reprint_revision='2';db.cards[0].printed_revision='0';
 await assert.rejects(confirmSampleCardReprinted(db,actor,first.id,'2'),rejected(403));
 await assert.rejects(confirmSampleCardReprinted(db,actor,first.id,'1',allow),rejected(409));
 assert.equal(db.cards[0].printed_revision,'0');
 assert.deepEqual(await confirmSampleCardReprinted(db,actor,first.id,'2',allow),{id:first.id,reprintRevision:'2',needsReprint:false});
 assert.equal(db.cards[0].printed_revision,'2');
 db.cards[0].reprint_revision='3';
 await assert.rejects(confirmSampleCardReprinted(db,actor,first.id,'2',allow),rejected(409));
 assert.equal(db.cards[0].printed_revision,'2');
 assert.deepEqual(await confirmSampleCardReprinted(db,actor,first.id,'3',allow),{id:first.id,reprintRevision:'3',needsReprint:false});
 await retireSampleCard(db,actor,first.id,allow);
 await assert.rejects(confirmSampleCardReprinted(db,actor,first.id,'3',allow),rejected(404));
});
test('AC-99 confirmation validates card/revision before SQL and blocks inactive principals',async()=>{
 const db=new Fixture();
 for(const [id,revision] of [['bad','0'],['12','-1'],['12','1.2'],['12','18446744073709551616'],['12','1e2']])
  await assert.rejects(confirmSampleCardReprinted(db,actor,id,revision,allow),rejected(400));
 assert.equal(db.queries.length,0);
 db.user!.is_active=0;await assert.rejects(confirmSampleCardReprinted(db,actor,'12','0',allow),rejected(401));
});
test('AC-87 management denies by default and rechecks active account/login before invoking fresh policy',async()=>{
 const db=new Fixture();await assert.rejects(createSampleCard(db,actor,{masterId:'41',fabricId:'23'}),rejected(403));assert.equal(db.cards.length,0);
 for(const user of [null,{id:'6',role:'admin',is_active:0},{id:'6',role:'sales',is_active:0}]){
  const denied=new Fixture();denied.user=user;await assert.rejects(createSampleCard(denied,actor,{masterId:'41',fabricId:'23'},allow),rejected(401));assert.equal(denied.cards.length,0);
 }
 const revoked=new Fixture();revoked.login=false;await assert.rejects(createSampleCard(revoked,actor,{masterId:'41',fabricId:'23'},allow),rejected(401));
 const changed=new Fixture();changed.user!.role='admin';let role='';
 await createSampleCard(changed,actor,{masterId:'41',fabricId:'23'},(fresh,action)=>{role=fresh.role;return action==='create'&&fresh.role==='admin';});
 assert.equal(role,'admin');
 assert.match(changed.queries[0].sql,/v2_access_users.*FOR SHARE/);assert.match(changed.queries[1].sql,/revoked_at IS NULL.*expires_at>UTC_TIMESTAMP\(\).*FOR SHARE/);
});
test('AC-87 strict two-ID input and unknown/inactive master or fabric never create a card',async()=>{
 for(const input of [{masterId:'41',fabricId:'23',qrPayload:'attacker'}, {masterId:['41'],fabricId:'23'}, {masterId:'0',fabricId:'23'}, {masterId:'41',fabricId:'18446744073709551616'}, null]){
  const db=new Fixture();await assert.rejects(createSampleCard(db,actor,input,allow),rejected(400));assert.equal(db.queries.length,0);
 }
 for(const key of ['master','fabric'] as const){
  for(const inactive of [false,true]){const db=new Fixture();if(inactive)db[key]!.is_active=0;else db[key]=null;
   await assert.rejects(createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow),rejected(409));assert.equal(db.cards.length,0);}
 }
});
test('AC-87 concurrent unique-key winner is returned without rotating its payload',async()=>{
 const db=new Fixture();db.duplicate=true;
 const result=await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 assert.equal(result.created,false);assert.equal(result.card.qrPayload,'existingStablePhysicalCardToken_12345');assert.equal(db.cards.length,1);assert.equal(db.tokens.length,1);
});
test('AC-94 token persistence failure rolls back card and releases connection',async()=>{
 const db=new Fixture();db.failure='token';await assert.rejects(createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow),/synthetic/);
 assert.equal(db.cards.length,0);assert.equal(db.tokens.length,0);assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
});
test('AC-89 current fabric fields and stable payload survive authorized list and explicit selected-order reads',async()=>{
 const db=new Fixture();const first=await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 db.master!.id='42';db.master!.master_no='0002';
 const second=await createSampleCard(db,actor,{masterId:'42',fabricId:'23'},allow);
 assert.notEqual(first.card.qrPayload,second.card.qrPayload);
 const listed=await listSampleCards(db,{query:'  %_!  ',limit:1,offset:1});assert.equal(listed.total,2);assert.equal(listed.limit,1);assert.equal(listed.offset,1);assert.equal(listed.items[0].id,second.card.id);
 const selected=await getSelectedSampleCards(db,[second.card.id,first.card.id]);assert.deepEqual(selected.map(c=>c.id),[second.card.id,first.card.id]);
 assert.deepEqual(selected.map(c=>c.qrPayload),[second.card.qrPayload,first.card.qrPayload]);
 const count=db.queries.find(q=>q.sql.includes('COUNT(*)'))!;assert(count.args.every(v=>v==='%!%!_!!%'));assert.match(count.sql,/LIKE \? ESCAPE '!'/);
 await assert.rejects(getSelectedSampleCards(db,['999',first.card.id]),rejected(404));
 for(const ids of [[],['12','12'],['0'],'12'])await assert.rejects(getSelectedSampleCards(db,ids),rejected(400));
 for(const q of [{limit:0},{offset:-1},{query:'\n'},{limit:101}])await assert.rejects(listSampleCards(db,q),rejected(400));
});
test('AC-94 malformed stored payload/hash and unsafe DB identities fail closed',async()=>{
 const db=new Fixture();await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 db.tokens[0].token_hash='a'.repeat(64);await assert.rejects(getSelectedSampleCards(db,['12']),rejected(409));
});
test('AC-89 existing card number drift fails explicitly instead of silently renumbering a printed card',async()=>{
 const db=new Fixture();await createSampleCard(db,actor,{masterId:'41',fabricId:'23'},allow);
 db.cards[0].master_no='9999';
 await assert.rejects(getSelectedSampleCards(db,['12']),rejected(409));
});


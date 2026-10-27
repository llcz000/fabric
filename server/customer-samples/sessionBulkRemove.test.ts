import test from 'node:test';
import assert from 'node:assert/strict';
import {removeSampleSessionCards} from './sessionRemove';
const actor={userId:'6',sessionId:'9',role:'sales'} as never;
class Db{
 items=[{id:'1',product_id:'11',removed_at:null,removed_by_user_id:null},{id:'2',product_id:'12',removed_at:null,removed_by_user_id:null}];events:string[]=[];commits=0;rolled=0;grant=true;closed=false;fail=false;calls:{sql:string;args:unknown[]}[]=[];
 async getConnection(){const snapshot=structuredClone(this.items);return {beginTransaction:async()=>{},commit:async()=>{this.commits++;},rollback:async()=>{this.items=snapshot;this.events=[];this.rolled++;},release(){},query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
  this.calls.push({sql,args});if(sql.includes('FROM v2_access_users'))return [[{role:'sales',is_active:1}],[]];if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.includes('FROM customer_sample_sessions'))return [[{id:'3',status:this.closed?'closed':'open'}],[]];if(sql.includes('SELECT can_manage'))return [this.grant?[{can_manage:1}]:[],[]];
  if(sql.includes('SELECT card_id FROM customer_sample_selected_cards'))return [args.slice(1).filter(id=>['7','8'].includes(String(id))).map(card_id=>({card_id})),[]];
  if(sql.includes('EXISTS')&&sql.includes('customer_sample_item_sources'))return [this.items.map(x=>({...x})),[]];
  if(sql.startsWith('UPDATE customer_sample_items')){const item=this.items.find(i=>i.id===args[2])!;item.removed_at='now' as never;item.removed_by_user_id='6' as never;return [{affectedRows:1},[]];}
  if(sql.startsWith('INSERT INTO customer_sample_item_removal_events')){if(this.fail&&this.events.length)throw Error('audit failure');this.events.push(String(args[1]));return [{affectedRows:1},[]];}
  throw Error('Unexpected SQL '+sql);
 }};}
}
test('bulk card removal covers all source-matched products, appends audit, and rolls back every row on failure',async()=>{
 const db=new Db();assert.deepEqual(await removeSampleSessionCards(db,actor,'3',['7','8']),{sessionId:'3',removedCount:2});assert.equal(db.events.length,2);assert.equal(db.commits,1);
 const locate=db.calls.find(c=>c.sql.includes('EXISTS'))!;assert(locate.sql.includes('customer_sample_manual_events'));assert(!locate.sql.includes('LIMIT'));assert(locate.sql.includes('FOR UPDATE'));
 const failed=new Db();failed.fail=true;await assert.rejects(removeSampleSessionCards(failed,actor,'3',['7']));assert(failed.items.every(i=>i.removed_at===null));assert.equal(failed.events.length,0);
 for(const key of ['grant']){const denied=new Db();if(key==='closed')denied.closed=true;else denied.grant=false;await assert.rejects(removeSampleSessionCards(denied,actor,'3',['7']));assert.equal(denied.commits,0);}const closed=new Db();closed.closed=true;assert.deepEqual(await removeSampleSessionCards(closed,actor,'3',['7']),{sessionId:'3',removedCount:2});
 for(const cards of [[],['7','7'],['bad'],['7','999']]){const denied=new Db();await assert.rejects(removeSampleSessionCards(denied,actor,'3',cards));assert(denied.items.every(item=>item.removed_at===null));}
});

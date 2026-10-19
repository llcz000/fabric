import assert from 'node:assert/strict';
import test from 'node:test';
import {exportV2DocumentSnapshot} from './documentExport';
const actor={userId:'7',sessionId:'11',role:'sales',username:'sales',displayName:'业务员',canManageOwnOrders:true,canManageProducts:true} as const;
function fixture(){let committed=0,rolledBack=0,released=0;const calls:{sql:string;args:unknown[]}[]=[];
 const connection={async beginTransaction(){},async commit(){committed++;},async rollback(){rolledBack++;},release(){released++;},async query(sql:string,args:unknown[]=[]){calls.push({sql,args});
  if(/^(SET|START)/.test(sql))return [[],[]] as [unknown,unknown];
  if(sql.startsWith('SELECT o.id FROM orders o'))return [String(args.at(-1))==='0'?[{id:'5'}]:[],[]] as [unknown,unknown];
  if(sql.startsWith('SELECT o.id,o.order_no'))return [[{id:5,order_no:'YB-1',order_date:'2026-10-17',receiving_unit:'客户',template_type:'sample',deposit:0,total_meters:1,total_pieces:0,total_amount:3,deduction_meters:0,created_by_user_id:'7',settled:0,v2_display_snapshot:null}],[]] as [unknown,unknown];
  if(sql.startsWith('SELECT i.id'))return [[],[]] as [unknown,unknown];throw Error('Unexpected query');
 }};
 return {pool:{async getConnection(){return connection;}},calls,state:()=>({committed,rolledBack,released})};
}
test('snapshot export uses consistent read-only transaction, mandatory owner SQL and stable keyset pages',async()=>{
 const f=fixture(),docs=[];for await(const record of exportV2DocumentSnapshot(f.pool,actor))docs.push(record);
 assert.equal(docs.length,1);assert.equal(docs[0].ownerId,'7');const pages=f.calls.filter(c=>c.sql.startsWith('SELECT o.id FROM'));
 assert(pages.every(c=>c.sql.includes('o.created_by_user_id = ?')&&c.args[0]==='7'));assert(f.calls.some(c=>c.sql.includes('WITH CONSISTENT SNAPSHOT, READ ONLY')));assert.deepEqual(f.state(),{committed:1,rolledBack:0,released:1});
});
test('client cancellation closes snapshot transaction and releases its physical connection',async()=>{
 const f=fixture(),iterator=exportV2DocumentSnapshot(f.pool,actor);await iterator.next();await iterator.return();assert.deepEqual(f.state(),{committed:0,rolledBack:1,released:1});
});
test('unauthenticated export never acquires a database connection',async()=>{
 let leases=0;const iterator=exportV2DocumentSnapshot({async getConnection(){leases++;throw Error('unexpected');}},null as any);
 await assert.rejects(iterator.next());assert.equal(leases,0);
});

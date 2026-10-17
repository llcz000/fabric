import assert from 'node:assert/strict';
import test from 'node:test';
import {resolvePrincipalFromToken,scopeOrdersQuery,createAuthenticatedSession} from './sessions';
import {hashSessionToken} from './password';
const fake=(state: {active?:boolean;orders?:boolean;products?:boolean;expired?:boolean;revoked?:boolean;role?:'admin'|'sales'})=>{
 const queries:{sql:string;params:unknown[]}[]=[];
 const conn={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   queries.push({sql,params});
   if(state.active===false||state.expired||state.revoked)return [[],[]];
   return [[{user_id:'11',username:'sales11',display_name:'业务员',role:state.role??'sales',
     can_manage_own_orders:state.orders?1:0,can_manage_products:state.products?1:0,session_id:'12'}],[]];
 }};
 return {conn,queries};
};
test('P2 active role grants shared operations independent of deprecated capability flags',async()=>{
 const state={active:true,orders:true,products:false};
 const {conn,queries}=fake(state);
 const token='a'.repeat(64);
 const before=await resolvePrincipalFromToken(conn,token);
 assert.equal(before?.canManageOwnOrders,true);
 assert.equal(before?.canManageProducts,true);
 state.orders=false;state.products=true;
 const after=await resolvePrincipalFromToken(conn,token);
 assert.equal(after?.canManageOwnOrders,true);
 assert.equal(after?.canManageProducts,true);
 assert.equal(queries.length,2);
 for(const q of queries){
   assert.match(q.sql,/JOIN v2_access_users/i);
   assert.match(q.sql,/u\.is_active=1/i);
   assert.match(q.sql,/s\.revoked_at IS NULL/i);
   assert.match(q.sql,/s\.expires_at > UTC_TIMESTAMP\(\)/i);
   assert.deepEqual(q.params,[hashSessionToken(token)]);
 }
});
test('P2 revoked, disabled, expired or malformed tokens are never authorized',async()=>{
 for(const s of [{active:false},{revoked:true},{expired:true}]){
   assert.equal(await resolvePrincipalFromToken(fake(s).conn,'b'.repeat(64)),null);
 }
 const f=fake({});
 assert.equal(await resolvePrincipalFromToken(f.conn,'invalid'),null);
 assert.equal(f.queries.length,0);
});
test('P2 salesperson query scoping is SQL-side; cross-actor owner id cannot be supplied by client',()=>{
 const actor={userId:'11',username:'sales11',displayName:'x',role:'sales' as const,canManageOwnOrders:true,canManageProducts:true,sessionId:'12'};
 assert.deepEqual(scopeOrdersQuery(actor),{predicate:'o.created_by_user_id = ?',parameters:['11']});
 assert.deepEqual(scopeOrdersQuery({...actor,role:'admin'}),{predicate:'1=1',parameters:[]});
 assert.throws(()=>scopeOrdersQuery(null),/unauthenticated/i);
});
test('P2 token creation stores only hashed session credential, never raw value',async()=>{
 const executed:{sql:string;params:unknown[]}[]=[];
 const conn={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   executed.push({sql,params});
   return [{insertId:55},[]];
 }};
 const issued=await createAuthenticatedSession(conn,'11',12*3600);
 assert.match(issued.token,/^[a-f0-9]{64}$/);
 assert.equal(issued.expiresIn,43200);
 assert.equal(executed.length,1);
 assert.match(executed[0].sql,/INSERT INTO v2_access_sessions/i);
 assert(executed[0].params.includes(hashSessionToken(issued.token)));
 assert(!executed[0].params.includes(issued.token));
});

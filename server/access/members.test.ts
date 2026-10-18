import assert from 'node:assert/strict';
import test from 'node:test';
import {createMember,changeMember,resetMemberPassword,MemberAccessError} from './members';
import {verifyPassword} from './password';
import type {AppPrincipal} from './types';

interface User {id:string;username:string;role:'admin'|'sales';active:boolean;own:boolean;products:boolean;passwordHash:string}
class Fixture {
 users=new Map<string,User>([
  ['1',{id:'1',username:'admin',role:'admin',active:true,own:true,products:true,passwordHash:'old'}],
  ['2',{id:'2',username:'second',role:'admin',active:true,own:true,products:true,passwordHash:'old'}],
  ['3',{id:'3',username:'sales',role:'sales',active:true,own:false,products:false,passwordHash:'old'}]
 ]);
 queries:{sql:string;params:unknown[]}[]=[];
 began=0;committed=0;rolled=0;failOnUpdate=false;revokedIds:string[]=[];
 async getConnection(){
  const that=this;
  return {
   async beginTransaction(){that.began++},
   async commit(){that.committed++},
   async rollback(){that.rolled++},
   release(){},
   async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
    that.queries.push({sql,params});
    if(sql.includes('role=\'admin\' AND is_active=1')&&sql.includes('FOR UPDATE')){
      return [[...that.users.values()].filter(u=>u.role==='admin'&&u.active).map(u=>({id:u.id})),[]];
    }
    if(sql.includes('FROM v2_access_users WHERE id=?')&&sql.includes('FOR UPDATE')){
      const u=that.users.get(String(params[0]));
      return [u?[{id:u.id,role:u.role,is_active:u.active?1:0}]:[],[]];
    }
    if(sql.includes('INSERT INTO v2_access_users')){
      const id=String(that.users.size+1);
      if([...that.users.values()].some(u=>u.username===String(params[1])))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});
      that.users.set(id,{id,username:String(params[1]),role:String(params[4]) as 'admin'|'sales',active:true,own:params[5]===1,products:params[6]===1,passwordHash:String(params[3])});
      return [{insertId:Number(id)},[]];
    }
    if(sql.includes('UPDATE v2_access_users SET')){
      if(that.failOnUpdate) throw Error('database down');
      const id=String(params.at(-1));
      const u=that.users.get(id);
      if(!u)return [{affectedRows:0},[]];
      if(sql.includes('role=?'))u.role=String(params[0]) as 'admin'|'sales';
      if(sql.includes('is_active=?'))u.active=params[0]===1;
      if(sql.includes('can_manage_own_orders=?'))u.own=params[0]===1;
      if(sql.includes('can_manage_products=?'))u.products=params[0]===1;
      if(sql.includes('password_hash=?'))u.passwordHash=String(params[0]);
      if(sql.includes('username=?,username_normalized=?,display_name=?')){
       if([...that.users.values()].some(other=>other.id!==id&&other.username.toLowerCase()===String(params[1])))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});
       u.username=String(params[0]);
      }
      return [{affectedRows:1},[]];
    }
    if(sql.includes('UPDATE v2_access_sessions SET revoked_at=')){
      that.revokedIds.push(String(params[0]));return [{affectedRows:1},[]];
    }
    throw Error('Unexpected SQL '+sql);
   }
  };
 }
}
const admin:AppPrincipal={userId:'1',username:'admin',displayName:'Admin',role:'admin',canManageOwnOrders:true,canManageProducts:true,sessionId:'10'};
const sales:AppPrincipal={...admin,userId:'3',role:'sales',username:'sales',canManageOwnOrders:true,canManageProducts:true};

test('admin edits login/display name with stable user ID, normalized uniqueness and no password or ownership mutation',async()=>{
 const db=new Fixture();const before=db.users.get('3')!.passwordHash;
 await changeMember(db,admin,'3',{username:'New.Staff',displayName:' 新姓名 '} as never);
 const write=db.queries.find(x=>x.sql.includes('username=?,username_normalized=?,display_name=?'));
 assert.deepEqual(write?.params,['New.Staff','new.staff','新姓名','3']);assert.equal(db.users.get('3')!.passwordHash,before);assert.equal(db.revokedIds.length,0);
 await denial(changeMember(db,admin,'3',{username:'ADMIN',displayName:'重名'} as never),409);
 await denial(changeMember(db,sales,'3',{username:'other',displayName:'无权'} as never),403);
 for(const patch of [{username:'bad name',displayName:'姓名'},{username:'good',displayName:' '},{username:'good',displayName:'x\n'},{username:'good'}])await denial(changeMember(db,admin,'3',patch as never),400);
});
async function denial(p:Promise<unknown>,status:number){
 await assert.rejects(p,(e:unknown)=>e instanceof MemberAccessError&&e.status===status);
}
test('AUTH member management needs no retired independent permission fields',async()=>{
 const db=new Fixture();
 const user=await createMember(db,admin,{username:'new_staff',displayName:'New Staff',password:'strong-p2-password',role:'sales'});
 assert.equal(user.username,'new_staff');
 const stored=db.users.get(user.id)!;
 assert.equal(stored.own,true);assert.equal(stored.products,true);
 await denial(changeMember(db,admin,user.id,{canManageProducts:false} as never),400);
});
test('P2-3 creates case-insensitively normalized user with role and hash only',async()=>{
 const db=new Fixture();
 const u=await createMember(db,admin,{username:'NEW_SALES',displayName:'New Sales',password:'strong-p2-password',role:'sales'});
 assert.equal(u.username,'new_sales');
 assert.equal(db.committed,1);
 assert.equal(db.rolled,0);
 const saved=[...db.users.values()].find(x=>x.username==='new_sales');
 assert(saved);
 assert.equal(saved.own,true);assert.equal(saved.products,true);
 assert.equal(await verifyPassword('strong-p2-password',saved.passwordHash),true);
 assert(!JSON.stringify(db.queries).includes('strong-p2-password'));
 await denial(createMember(db,admin,{username:'NEW_SALES',displayName:'Repeat',password:'strong-p2-password',role:'sales'}),409);
});
test('P2-3 non-admin even both delegated permissions cannot manage members',async()=>{
 const db=new Fixture();
 await denial(changeMember(db,sales,'2',{isActive:false}),403);
 await denial(resetMemberPassword(db,sales,'2','strong-password2'),403);
 await denial(createMember(db,sales,{username:'unauthorized',displayName:'No',password:'strong-password2',role:'admin'}),403);
 assert.equal(db.began,0);
});
test('P2-3 final admin may neither be disabled nor demoted',async()=>{
 const db=new Fixture();
 await changeMember(db,admin,'2',{isActive:false});
 assert.equal(db.users.get('2')?.active,false);
 await denial(changeMember(db,admin,'1',{isActive:false}),409);
 await denial(changeMember(db,admin,'1',{role:'sales'}),409);
 assert.equal(db.users.get('1')?.active,true);
 assert.equal(db.users.get('1')?.role,'admin');
 assert.equal(db.committed,1);
 assert.equal(db.rolled,2);
 assert(db.queries.filter(q=>q.sql.includes('FOR UPDATE')).length>=3);
});
test('AUTH role change and deactivation revoke sessions while retired grant patches are refused',async()=>{
 const db=new Fixture();
 await denial(changeMember(db,admin,'3',{canManageOwnOrders:true} as never),400);
 await denial(changeMember(db,admin,'3',{canManageProducts:true} as never),400);
 assert.equal(db.users.get('3')?.own,false);
 assert.equal(db.users.get('3')?.products,false);
 await changeMember(db,admin,'2',{role:'sales'});
 assert(db.revokedIds.includes('2'));
 await changeMember(db,admin,'3',{isActive:false});
 assert(db.revokedIds.includes('3'));
});
test('P2-3 reset password revokes active sessions in same transaction and rejects DB mutation errors',async()=>{
 const db=new Fixture();
 await resetMemberPassword(db,admin,'3','new-more-secure-password');
 assert(db.revokedIds.includes('3'));
 assert.equal(await verifyPassword('new-more-secure-password',db.users.get('3')!.passwordHash),true);
 const failure=new Fixture();failure.failOnUpdate=true;
 await assert.rejects(resetMemberPassword(failure,admin,'3','new-more-secure-password'),/database down/);
 assert.equal(failure.committed,0);
 assert.equal(failure.rolled,1);
});
test('P2-3 actor identity re-read inside same transaction and disabled actor cannot mutate',async()=>{
 const db=new Fixture();db.users.get('1')!.active=false;
 await denial(changeMember(db,admin,'3',{isActive:false}),403);
 assert.equal(db.users.get('3')?.active,true);
});

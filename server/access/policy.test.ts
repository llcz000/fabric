import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadOrder,canManageOrder,canReadProducts,canManageProducts,canImportFabricOverwrite,canExportProducts,canAdminManualOrder,canManageMembers,canDeactivateUser,assertOrderVisible,canCreateOwnOrder } from './policy';
import type {AppPrincipal} from './types';
const admin:AppPrincipal={userId:'a',username:'admin',displayName:'管理员',role:'admin',canManageOwnOrders:true,canManageProducts:true,sessionId:'s0'};
const sales=(userId:string,own=false,products=false):AppPrincipal=>({userId,username:userId,displayName:userId,role:'sales',canManageOwnOrders:own,canManageProducts:products,sessionId:'sx'});
test('P2 only logged-in admin or own salesperson sees an owned document; unknown owner denied',()=>{
 const own={createdByUserId:'u1'},other={createdByUserId:'u2'},old={createdByUserId:null};
 for(const actor of [sales('u1'),sales('u1',true),sales('u1',false,true),sales('u1',true,true)]){
   assert.equal(canReadOrder(actor,own),true);
   assert.equal(canReadOrder(actor,other),false);
   assert.equal(canReadOrder(actor,old),false);
   assert.throws(()=>assertOrderVisible(actor,other),/not found/i);
 }
 assert.equal(canReadOrder(admin,other),true);
 assert.equal(canReadOrder(admin,old),true);
 assert.equal(canReadOrder(null,own),false);
});
test('P2 sales owns their orders and shared catalog regardless deprecated grants; cross-owner writes denied',()=>{
 const a=sales('u1',true,false),b=sales('u1',false,true),both=sales('u1',true,true);
 assert.equal(canManageOrder(a,{createdByUserId:'u1'}),true);
 assert.equal(canManageOrder(a,{createdByUserId:'u2'}),false);
 assert.equal(canManageProducts(a),true);
 assert.equal(canManageOrder(b,{createdByUserId:'u1'}),true);
 assert.equal(canManageProducts(b),true);
 assert.equal(canManageOrder(both,{createdByUserId:'u2'}),false);
 assert.equal(canManageOrder(both,{createdByUserId:null}),false);
 assert.equal(canManageOrder(admin,{createdByUserId:'u2'}),true);
 assert.equal(canManageOrder(null,{createdByUserId:'u1'}),false);
 assert.equal(canCreateOwnOrder(sales('u1',false,false)),true);
});
test('P2 both roles share catalog/export/import; accounts and manual order remain admin-only',()=>{
 for(const actor of [sales('u1'),sales('u1',true),sales('u1',false,true),sales('u1',true,true)]){
   assert.equal(canReadProducts(actor),true);
   assert.equal(canImportFabricOverwrite(actor),true);
   assert.equal(canExportProducts(actor),true);
   assert.equal(canAdminManualOrder(actor),false);
   assert.equal(canManageMembers(actor),false);
 }
 assert.equal(canReadProducts(null),false);
 assert.equal(canManageProducts(null),false);
 for(const action of [canImportFabricOverwrite,canExportProducts,canAdminManualOrder,canManageMembers]) assert.equal(action(admin),true);
});
test('2026-10-15 role simplification: both roles have shared business privileges regardless deprecated grant flags',()=>{
 for(const principal of [admin,sales('u1',false,false),sales('u1',true,true)]){
  assert.equal(canManageProducts(principal),true);
  assert.equal(canImportFabricOverwrite(principal),true);
  assert.equal(canExportProducts(principal),true);
  assert.equal(canCreateOwnOrder(principal),true);
 }
 assert.equal(canAdminManualOrder(sales('u1',true,true)),false);
 assert.equal(canManageMembers(sales('u1',true,true)),false);
 assert.equal(canImportFabricOverwrite(null),false);
 assert.equal(canManageProducts(null),false);
});
test('P2 last active administrator must never be disabled',()=>{
 assert.equal(canDeactivateUser(admin,{userId:'a',role:'admin',isActive:true},1),false);
 assert.equal(canDeactivateUser(admin,{userId:'a',role:'admin',isActive:true},2),true);
 assert.equal(canDeactivateUser(admin,{userId:'u1',role:'sales',isActive:true},1),true);
 assert.equal(canDeactivateUser(sales('u1',true,true),{userId:'u2',role:'sales',isActive:true},2),false);
});

import type {AppPrincipal,AppRole,OwnedOrder} from './types';

/** Authorization is always evaluated against a fresh server-verified principal. */
export const isAdmin=(actor:AppPrincipal|null|undefined):boolean=>actor?.role==='admin';
export const canReadProducts=(actor:AppPrincipal|null|undefined):boolean=>actor!=null;
export const canManageProducts=(actor:AppPrincipal|null|undefined):boolean=>
  actor?.role==='admin'||actor?.role==='sales';
export const canReadOrder=(actor:AppPrincipal|null|undefined,order:OwnedOrder):boolean=>
  isAdmin(actor) || (actor?.role==='sales' && !!order.createdByUserId && actor.userId===order.createdByUserId);
export const canManageOrder=(actor:AppPrincipal|null|undefined,order:OwnedOrder):boolean=>
  isAdmin(actor) || (actor?.role==='sales' && !!order.createdByUserId && actor.userId===order.createdByUserId);
export const canCreateOwnOrder=(actor:AppPrincipal|null|undefined):boolean=>
  actor?.role==='admin'||actor?.role==='sales';
// The two legacy grant columns remain stored for schema compatibility, but
// current business authority comes from a live registered admin/sales role.
export const canImportFabricOverwrite=canManageProducts;
export const canExportProducts=canManageProducts;
export const canAdminManualOrder=isAdmin;
export const canManageMembers=isAdmin;
/** Deny cross-owner reads with 404, not 403; resource existence must not leak. */
export function assertOrderVisible(actor:AppPrincipal|null|undefined,order:OwnedOrder):void {
  if(!canReadOrder(actor,order)) throw new Error('Order not found');
}
export function canDeactivateUser(
 actor:AppPrincipal|null|undefined,
 target:{userId:string;role:AppRole;isActive:boolean},
 numberOfActiveAdmins:number,
):boolean {
  if(!isAdmin(actor)) return false;
  if(target.role==='admin' && target.isActive && numberOfActiveAdmins<=1) return false;
  return true;
}

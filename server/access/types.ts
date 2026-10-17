/** Product Master V2 P2 fixed-role access contracts. Principal is server-issued only. */
export type AppRole='admin'|'sales';
export interface AppPrincipal {
  userId:string;
  username:string;
  displayName:string;
  role:AppRole;
  canManageOwnOrders:boolean;
  canManageProducts:boolean;
  sessionId:string;
}
export interface AppUserRecord {
  id:string;
  username:string;
  displayName:string;
  role:AppRole;
  passwordHash:string;
  isActive:boolean;
  canManageOwnOrders:boolean;
  canManageProducts:boolean;
}
export interface AppSessionRecord {
  id:string;
  userId:string;
  tokenHash:string;
  expiresAt:Date;
  revokedAt:Date|null;
}
export interface OwnedOrder {
  createdByUserId:string|null|undefined;
}

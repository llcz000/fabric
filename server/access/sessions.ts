import type {AppPrincipal} from './types';
import {createSessionToken,hashSessionToken} from './password';

interface AccessQuery {
  query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
function validToken(raw:unknown):raw is string{
 return typeof raw==='string' && /^[a-f0-9]{64}$/.test(raw);
}
/**
 * Every authenticated request must rejoin current user state: no capability
 * snapshot cached in sessions, and disabled accounts cease to resolve.
 */
export async function resolvePrincipalFromToken(connection:AccessQuery,token:unknown):Promise<AppPrincipal|null>{
 if(!validToken(token)) return null;
 const [rawRows]=await connection.query(
   `SELECT u.id AS user_id,u.username,u.display_name,u.role,
      u.can_manage_own_orders,u.can_manage_products,s.id AS session_id
    FROM v2_access_sessions s
    JOIN v2_access_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL
      AND s.expires_at > UTC_TIMESTAMP() AND u.is_active=1
    LIMIT 1`,
   [hashSessionToken(token)]
 );
 const rows=Array.isArray(rawRows)?rawRows as Record<string,unknown>[]:[];
 const row=rows[0]; if(!row)return null;
 if(row.role!=='admin'&&row.role!=='sales')return null;
 return {
   userId:String(row.user_id),username:String(row.username),
   displayName:String(row.display_name),role:row.role,
   // Compatibility response fields; deprecated grant flags no longer restrict
   // registered active sales/admin accounts under the 2026-10-15 role policy.
   canManageOwnOrders:true,
   canManageProducts:true,
   sessionId:String(row.session_id)
 };
}
export function scopeOrdersQuery(principal:AppPrincipal|null|undefined):{
  predicate:string;parameters:string[];
}{
 if(!principal)throw Error('Unauthenticated');
 return principal.role==='admin'
  ? {predicate:'1=1',parameters:[]}
  : {predicate:'o.created_by_user_id = ?',parameters:[principal.userId]};
}
/** Session rows hold only the SHA-256 hash; raw bearer is returned once. */
export async function createAuthenticatedSession(
  connection:AccessQuery,userId:string,expiresIn:number
):Promise<{token:string;expiresIn:number}>{
 if(!/^[1-9]\d*$/.test(userId)||!Number.isInteger(expiresIn)||expiresIn<60||expiresIn>12*3600)
   throw Error('Invalid session duration or user');
 const token=createSessionToken();
 await connection.query(
   'INSERT INTO v2_access_sessions (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND))',
   [userId,hashSessionToken(token),expiresIn]
 );
 return {token,expiresIn};
}

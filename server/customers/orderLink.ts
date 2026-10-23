import type {AppPrincipal} from '../access/types';
import type {SampleTx} from '../customer-samples/scanRepository';
import {z} from 'zod';
import {CustomerError,customerId,requestId,parse,parseCustomerProfile,rows,id} from './model';
import {lockCustomer} from './access';
import {insertCustomer} from './service';
export const orderCustomerSchema=z.object({customerId:customerId.nullable().optional(),profile:z.unknown().optional(),requestId:requestId.optional(),expectedCustomerId:customerId.nullable().optional(),expectedLinkVersion:z.string().regex(/^(0|[1-9]\d{0,19})$/).optional()}).strict().refine(v=>!(v.customerId&&v.profile!==undefined));
export interface OrderCustomerLink{customerId:string|null;linkVersion:string}
export async function readOrderCustomer(tx:Pick<SampleTx,'query'>,orderId:string):Promise<OrderCustomerLink>{
 const [raw]=await tx.query('SELECT customer_id,row_version FROM customer_order_links WHERE order_id=?',[orderId]);const row=rows(raw)[0];return {customerId:row?.customer_id==null?null:id(row.customer_id),linkVersion:String(row?.row_version??0)};
}
export async function prepareOrderCustomer(tx:SampleTx,actor:AppPrincipal,input:unknown,orderId?:string){
 const b=parse(orderCustomerSchema,input);const before=orderId?await readOrderCustomer(tx,orderId):{customerId:null,linkVersion:'0'};
 if(orderId&&(b.expectedCustomerId!==before.customerId||b.expectedLinkVersion!==before.linkVersion))throw new CustomerError(409);
 const cid=b.profile!==undefined?await insertCustomer(tx,actor,parseCustomerProfile(b.profile)):b.customerId??null;
 if(!orderId&&!cid)throw new CustomerError(400);
 let name:string|undefined;
 for(const target of [...new Set([before.customerId,cid].filter((v):v is string=>v!==null))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)){
  const same=target===before.customerId&&cid===before.customerId;const c=await lockCustomer(tx,actor,target,!same,same||target!==cid);if(target===cid)name=c.dto.profile.displayName;
 }
 return {customerId:cid,name,before};
}
export async function writeOrderCustomer(tx:SampleTx,actor:AppPrincipal,orderId:string,prepared:Awaited<ReturnType<typeof prepareOrderCustomer>>){
 const [raw]=await tx.query('SELECT customer_id,row_version FROM customer_order_links WHERE order_id=? FOR UPDATE',[orderId]);const row=rows(raw)[0];
 const current={customerId:row?.customer_id==null?null:String(row.customer_id),linkVersion:String(row?.row_version??0)};
 if(current.customerId!==prepared.before.customerId||current.linkVersion!==prepared.before.linkVersion)throw new CustomerError(409);
 if(current.customerId===prepared.customerId)return;
 if(row)await tx.query('UPDATE customer_order_links SET customer_id=?,linked_by_user_id=?,row_version=row_version+1 WHERE order_id=?',[prepared.customerId,actor.userId,orderId]);
 else await tx.query('INSERT INTO customer_order_links(order_id,customer_id,linked_by_user_id) VALUES (?,?,?)',[orderId,prepared.customerId,actor.userId]);
 for(const cid of new Set([current.customerId,prepared.customerId].filter(Boolean)))await tx.query('INSERT INTO customer_profile_events(customer_id,actor_user_id,event_type,detail_json) VALUES (?,?,?,?)',[cid,actor.userId,'document_link_changed',JSON.stringify({orderId,from:current.customerId,to:prepared.customerId})]);
}

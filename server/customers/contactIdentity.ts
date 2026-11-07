import {createHash,randomBytes} from 'node:crypto';
import type {SampleTx} from '../customer-samples/scanRepository';
import {sampleContactChoices} from '../../src/lib/sampleContactChoices';
import {CustomerError,type CustomerProfile} from './model';

export function hydrateContactIds(profile:CustomerProfile,customerId:string):CustomerProfile{
 return {...profile,contacts:profile.contacts.map((contact,index)=>({...contact,id:contact.id??createHash('sha256').update('fabric/customer/contact/'+customerId+'/'+index).digest('hex').slice(0,32)}))};
}
export function saveContactIds(profile:CustomerProfile,previous?:CustomerProfile):CustomerProfile{
 const existing=new Map(previous?.contacts.map(contact=>[contact.id,contact]));
 const used=new Set<string>();
 for(const contact of profile.contacts){
  if(!previous||!contact.id)continue;
  if(!existing.has(contact.id)||used.has(contact.id))throw new CustomerError(409);
  used.add(contact.id);
 }
 return {...profile,contacts:profile.contacts.map(contact=>{
  if(previous&&contact.id)return contact;
  const matches=previous?.contacts.filter(old=>old.id&&!used.has(old.id)&&old.name===contact.name&&old.phone===contact.phone&&old.wechat===contact.wechat)??[];
  const id=matches.length===1?matches[0].id!:randomBytes(16).toString('hex');
  used.add(id);return {...contact,id};
 })};
}
export function identifiedContactChoices(profile:CustomerProfile){
 return sampleContactChoices(profile.contacts).map(choice=>({...choice,id:profile.contacts[choice.index].id!}));
}
export async function syncSelectionContactNames(tx:SampleTx,customerId:string,previous:CustomerProfile,profile:CustomerProfile){
 const oldChoices=identifiedContactChoices(previous),current=new Map(identifiedContactChoices(profile).map(choice=>[choice.id,choice.name]));
 const previousLabels=new Map(oldChoices.map(choice=>[choice.id,choice.name]));
 for(const contact of previous.contacts){
  const id=contact.id!;
  const old=previousLabels.get(id),name=current.get(id)??old;
  const legacyName=old&&old===contact.name&&oldChoices.filter(choice=>choice.name===old).length===1?old:null;
  if(!name||(!legacyName&&name===old))continue;
  await tx.query('UPDATE customer_sample_sessions SET contact_id=?,contact_name=? WHERE deleted_at IS NULL AND id IN (SELECT session_id FROM customer_session_links WHERE customer_id=?) AND (contact_id=? OR (contact_id IS NULL AND CAST(contact_name AS BINARY)=CAST(? AS BINARY)))',
   [id,name,customerId,id,legacyName]);
 }
}

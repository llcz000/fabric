export interface CustomerProfile {
 important?:boolean;notes?:string|null;styleTagIds?:string[];commonFabricIds?:string[];fabricNote?:string|null;nextFollowupOn?:string|null;followupNote?:string|null;
 displayName:string;subjectType:'company'|'individual'|'unknown';invoiceTitle:string|null;brands:string[];
 contacts:{name:string;phone:string|null;wechat:string|null}[];region:string|null;salesChannel:'online'|'offline'|'both'|'unknown';
 prices:{fabricCategory:string;minPrice:string|null;maxPrice:string|null;currency:string;unit:'metre'|'yard'|null;taxBasis:'included'|'excluded'|'unknown';remark:string|null}[];
 tier:'A'|'B'|'C'|'unrated';tierReason:string|null;relationshipStage:'prospect'|'sampling'|'trading'|'repeat'|'unknown';stageReason:string|null;
}
export interface CustomerDTO {id:string;profile:CustomerProfile;ownerUserId:string;rowVersion:string;archived:boolean;deleted?:boolean;canDelete?:boolean;canEdit:boolean;canManageAccess:boolean;canTransferOwner?:boolean;access:{userId:string;permission:'view'|'edit'}[]}
export interface CustomerSession {id:string;customerReference:string;status:'open'|'closed';createdOn?:string}
export interface CustomerTask {canEdit?:boolean;id:string;customerId:string;customerName:string;dueOn:string|null;nextAction:string;status:'open'|'done'|'cancelled';rowVersion:string;assigneeUserId:string}
export interface CustomerActivity {kind:'session'|'sample-followup'|'document';documentType?:'sample'|'bulk'|'deposit';amount?:string;id:string;sessionId?:string;summary:string;occurredOn:string}
export interface Page<T>{items:T[];total:number;limit:number;offset:number}
export const emptyCustomerProfile=():CustomerProfile=>({displayName:'',subjectType:'unknown',invoiceTitle:null,brands:[],contacts:[{name:'',phone:null,wechat:null}],region:null,salesChannel:'unknown',prices:[],tier:'unrated',tierReason:null,relationshipStage:'unknown',stageReason:null});
const nullable=(v:string|null)=>v?.trim()||null;
function greater(a:string,b:string){const [ai,af='']=a.split('.'),[bi,bf='']=b.split('.');const x=ai.replace(/^0+(?=\d)/,''),y=bi.replace(/^0+(?=\d)/,'');return x.length!==y.length?x.length>y.length:x!==y?x>y:af.padEnd(Math.max(af.length,bf.length),'0')>bf.padEnd(Math.max(af.length,bf.length),'0');}
export function prepareCustomerProfile(profile:CustomerProfile):CustomerProfile {
 const result:CustomerProfile={...profile,displayName:profile.displayName.trim(),invoiceTitle:nullable(profile.invoiceTitle),fabricNote:nullable(profile.fabricNote??null),region:nullable(profile.region),brands:profile.brands.map(x=>x.trim()).filter(Boolean),contacts:profile.contacts.map(x=>({name:x.name.trim(),phone:nullable(x.phone),wechat:nullable(x.wechat)})).filter(x=>x.name||x.phone||x.wechat),tierReason:nullable(profile.tierReason),stageReason:nullable(profile.stageReason),prices:profile.prices.map(p=>({...p,fabricCategory:p.fabricCategory.trim(),minPrice:nullable(p.minPrice),maxPrice:nullable(p.maxPrice),currency:p.currency.trim(),remark:nullable(p.remark)}))};
 if(!result.displayName)throw Error('请填写客户名称');


 for(const p of result.prices){for(const value of [p.minPrice,p.maxPrice])if(value!==null&&!/^\d+(?:\.\d+)?$/.test(value))throw Error('价格须为非负十进制数');if(p.minPrice!==null&&p.maxPrice!==null&&greater(p.minPrice,p.maxPrice))throw Error('价格下限不得高于上限');}
 return result;
}
export class CustomerHttpError extends Error {constructor(public status:number){super(status===409?'资料已变更或请求发生冲突，草稿已保留。请重新读取核对后再保存。':status===401||status===403||status===404?'当前资料不可访问，请重新读取或检查权限。':status===400||status===422?'资料未通过校验，请检查输入内容。':'操作未确认，请重试；相同内容将沿用原请求。');}}
export function createCustomerClient(apiFetch:typeof fetch){
 const retries=new Map<string,{payload:string;requestId:string}>();
 async function request<T>(path:string,init:RequestInit={}):Promise<T>{const response=await apiFetch('/api/v2'+path,{...init,cache:'no-store',headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}});if(!response.ok)throw new CustomerHttpError(response.status);return response.json();}
 async function create<T>(path:string,payload:unknown,signal?:AbortSignal):Promise<T>{const serialized=JSON.stringify(payload);let retry=retries.get(path);if(!retry||retry.payload!==serialized){retry={payload:serialized,requestId:crypto.randomUUID()};retries.set(path,retry);}const data=await request<T>(path,{method:'POST',body:JSON.stringify({requestId:retry.requestId,...payload as object}),signal});retries.delete(path);return data;}
 const customerPath=(id:string)=>'/customers/'+encodeURIComponent(id);
 return {
 deletionInfo:(id:string)=>request<{sessions:number;sample:number;bulk:number;deposit:number}>(customerPath(id)+'/deletion-info'),
 remove:(c:CustomerDTO)=>request(customerPath(c.id),{method:'DELETE',body:JSON.stringify({expectedRowVersion:c.rowVersion,confirm:true})}),
 capability:(signal?:AbortSignal)=>request<{enabled:boolean}>('/customers/capability',{signal}),
 list:(filters:Record<string,string|number|boolean>={},signal?:AbortSignal)=>request<Page<CustomerDTO>>('/customers?'+new URLSearchParams(Object.entries({limit:20,offset:0,...filters}).filter(([k,v])=>!['channel','tier','stage','due'].includes(k)||String(v)!=='').map(([k,v])=>[k,String(v)])),{signal}),
 detail:(id:string,signal?:AbortSignal)=>request<CustomerDTO>(customerPath(id),{signal}),
 create:(profile:CustomerProfile,signal?:AbortSignal)=>create<CustomerDTO>('/customers',{profile:prepareCustomerProfile(profile)},signal),
 save:(c:CustomerDTO,profile:CustomerProfile,signal?:AbortSignal)=>request<CustomerDTO>(customerPath(c.id),{method:'PATCH',body:JSON.stringify({expectedRowVersion:c.rowVersion,profile:prepareCustomerProfile(profile)}),signal}),
 createSession:(payload:{customerId:string}|{profile:CustomerProfile},signal?:AbortSignal)=>create<{customer:CustomerDTO;session:CustomerSession}>('/customers/with-sample-session','profile' in payload?{profile:prepareCustomerProfile(payload.profile)}:payload,signal),
 activity:(id:string,offset=0,signal?:AbortSignal)=>request<Page<CustomerActivity>&{salesAmount:string}>(customerPath(id)+'/activity?limit=20&offset='+offset,{signal}),
 tasks:(filters:Record<string,string|number>={},signal?:AbortSignal)=>request<Page<CustomerTask>>('/customer-tasks?'+new URLSearchParams(Object.entries({limit:20,offset:0,due:'all',status:'open',...filters}).map(([k,v])=>[k,String(v)])),{signal}),
 followup:(id:string,payload:unknown,signal?:AbortSignal)=>create<{id:string}>(customerPath(id)+'/followups',payload,signal),
 taskStatus:(task:CustomerTask,status:'done'|'cancelled',signal?:AbortSignal)=>request('/customer-tasks/'+encodeURIComponent(task.id),{method:'PATCH',body:JSON.stringify({expectedRowVersion:task.rowVersion,status}),signal}),
 change:(c:CustomerDTO,action:'archive'|'access'|'transfer-owner',payload:Record<string,unknown>,signal?:AbortSignal,remove=false)=>request<CustomerDTO>(customerPath(c.id)+'/'+action+(action==='access'?'/'+encodeURIComponent(String(payload.userId)):''),{method:action==='access'?(remove?'DELETE':'PUT'):'POST',body:JSON.stringify({expectedRowVersion:c.rowVersion,...(action==='access'?{permission:payload.permission}:payload)}),signal}),
 };
}
export type CustomerClient=ReturnType<typeof createCustomerClient>;
export const customerError=(cause:unknown)=>cause instanceof CustomerHttpError?cause.message:cause instanceof Error&&/^(请|价格)/.test(cause.message)?cause.message:'操作未确认，请重试；已填写的草稿将保留。';

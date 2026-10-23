import {z} from 'zod';
export class CustomerError extends Error{constructor(readonly status:400|403|404|409|503){super('Customer request unavailable');}}
export const validCustomerId=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
export const customerId=z.string().refine(validCustomerId);
const text=(max:number)=>z.string().trim().max(max).refine(v=>!/[\p{Cc}\p{Cf}]/u.test(v));
const optionalText=(max:number)=>text(max).transform(v=>v||null).nullable();
const price=z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/).nullable();
const contact=z.object({name:text(100),phone:optionalText(100),wechat:optionalText(100)}).strict();
const pricePreference=z.object({fabricCategory:text(100).default(''),minPrice:price,maxPrice:price,currency:z.union([z.string().regex(/^[A-Z]{3}$/),z.literal('')]).default(''),unit:z.enum(['metre','yard']).nullable().default(null),taxBasis:z.enum(['included','excluded','unknown']).default('unknown'),remark:optionalText(400).default(null)}).strict().refine(v=>(v.minPrice!==null||v.maxPrice!==null)&&(v.minPrice===null||v.maxPrice===null||cents(v.minPrice)<=cents(v.maxPrice)));
function cents(v:string){const [a,b='']=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const customerProfileSchema=z.object({displayName:text(160).min(1),subjectType:z.enum(['company','individual','unknown']).default('unknown'),invoiceTitle:optionalText(200).default(null),brands:z.array(text(100).min(1)).max(30).default([]),contacts:z.array(contact).max(20).default([]),region:optionalText(100).default(null),salesChannel:z.enum(['online','offline','both','unknown']).default('unknown'),prices:z.array(pricePreference).max(50).default([]),tier:z.enum(['A','B','C','unrated']).default('unrated'),tierReason:optionalText(400).default(null),relationshipStage:z.enum(['prospect','sampling','trading','repeat','unknown']).default('unknown'),stageReason:optionalText(400).default(null),important:z.boolean().default(false),notes:optionalText(2000).default(null),styleTagIds:z.array(customerId).max(30).default([]),commonFabricIds:z.array(customerId).max(50).default([]),fabricNote:optionalText(400).default(null),nextFollowupOn:date.nullable().default(null),followupNote:optionalText(400).default(null)}).strict().transform(v=>({...v,brands:[...new Set(v.brands)],styleTagIds:[...new Set(v.styleTagIds)],commonFabricIds:[...new Set(v.commonFabricIds)]}));
export type CustomerProfile=z.infer<typeof customerProfileSchema>;
export interface CustomerDTO{id:string;profile:CustomerProfile;ownerUserId:string;rowVersion:string;archived:boolean;deleted?:boolean;canDelete?:boolean;canEdit:boolean;canManageAccess:boolean;canTransferOwner:boolean;access:{userId:string;permission:'view'|'edit'}[]}
export const parseCustomerProfile=(value:unknown):CustomerProfile=>{const v=customerProfileSchema.safeParse(value);if(!v.success)throw new CustomerError(400);return v.data;};
export const requestId=z.string().uuid();
export const version=customerId;
export const followupSchema=z.object({requestId,contactedOn:date,feedback:optionalText(2000),outcome:text(400).min(1),nextAction:optionalText(400),nextFollowupOn:date.nullable(),sessionId:customerId.optional()}).strict().refine(v=>v.nextFollowupOn===null||v.nextFollowupOn>=v.contactedOn&&Boolean(v.nextAction));
export const parseContactFollowup=(v:unknown)=>{const p=followupSchema.safeParse(v);if(!p.success)throw new CustomerError(400);return p.data;};
export function shanghaiToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export const rows=(v:unknown):Record<string,any>[]=>{if(!Array.isArray(v)||v.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new CustomerError(503);return v;};
export const id=(v:unknown)=>{if(typeof v==='number'&&!Number.isSafeInteger(v))throw new CustomerError(503);const n=String(v);if(!validCustomerId(n))throw new CustomerError(503);return n;};
export function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new CustomerError(400);return result.data;}

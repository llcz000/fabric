import {migrateBusinessSimplification,BUSINESS_SIMPLIFICATION_PLAN_SHA256} from '../../server/audit/businessSimplificationSchema';
import {rehearseBusinessSimplification} from './business-simplification-rehearsal';
import {migrateFabricNumber,FABRIC_NUMBER_PLAN_SHA256} from '../../server/product-master/fabricNumberSchema';
import {rehearseFabricNumbers} from './fabric-number-rehearsal';
import {migratePatternNumberReuse,PATTERN_NUMBER_REUSE_PLAN_SHA256} from '../../server/product-master/patternNumberReuseSchema';
import {rehearsePatternNumberReuse} from './pattern-number-reuse-rehearsal';
import {rehearsePatternDeletion} from './pattern-deletion-rehearsal';
import {migratePatternDeletion,PATTERN_DELETION_PLAN_SHA256} from '../../server/product-master/patternDeletionSchema';
import {rehearseFabricDeletion} from './fabric-deletion-rehearsal';
import {migrateFabricDeletion,FABRIC_DELETION_PLAN_SHA256} from '../../server/product-master/fabricDeletionSchema';
import {rehearseCustomerV12} from './customer-v12-rehearsal';
import {migrateCustomerOrders,CUSTOMER_ORDER_PLAN_SHA256} from '../../server/customers/orderLinkSchema';
/** Registered additive migrations only. Never imported by application startup. */
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import {migrateCustomers,CUSTOMER_PLAN_SHA256} from '../../server/customers/schema';
import {migrateCardShareLinks,CARD_SHARE_PLAN_SHA256} from '../../server/customer-share/cardShareMigration';
import {rehearseCustomers} from './customer-rehearsal';
const registry={
 'business-simplification':{sha256:BUSINESS_SIMPLIFICATION_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateBusinessSimplification(p,t,b)},
 'fabric-number-nonempty':{sha256:FABRIC_NUMBER_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateFabricNumber(p,t,b)},
 'pattern-number-reuse':{sha256:PATTERN_NUMBER_REUSE_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migratePatternNumberReuse(p,t,b)},
 'pattern-deletion':{sha256:PATTERN_DELETION_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migratePatternDeletion(p,t,b)},
 'fabric-deletion':{sha256:FABRIC_DELETION_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateFabricDeletion(p,t,b)},
 'customer-v12':{sha256:CUSTOMER_ORDER_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateCustomerOrders(p,t,b,'APPLY_CUSTOMER_V12')},
 'card-share':{sha256:CARD_SHARE_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateCardShareLinks(p,t,b,'APPLY_CARD_SHARE')},
 'light-customers':{sha256:CUSTOMER_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateCustomers(p,t,b,'APPLY_CUSTOMERS')}
};
async function main(){
 const [mode,database,serverUuid,backupSha,rawIds]=process.argv.slice(2);
 assert(['migrate','rehearse','plans'].includes(mode));
 const ids=rawIds?.split(',')??[];assert(ids.length&&new Set(ids).size===ids.length&&ids.every(x=>Object.hasOwn(registry,x)));
 const plans=Object.fromEntries(ids.map(id=>[id,registry[id as keyof typeof registry].sha256]));
 if(mode==='plans'){console.log(JSON.stringify(plans));return;}
 assert(/^[A-Za-z0-9_]{1,64}$/.test(database));assert(/^[a-f0-9-]{36}$/.test(serverUuid));assert(/^[a-f0-9]{64}$/.test(backupSha));
 if(mode==='rehearse')assert(/^fabric_release_check_[a-f0-9]{16}$/.test(database));else assert.equal(database,'fabric_db');
 const pool=mysql.createPool({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,connectionLimit:3});
 try{
  const target={database,serverUuid},results:Record<string,unknown>={};
  for(const id of ids){const migration=registry[id as keyof typeof registry];const result=await migration.apply(pool,target,backupSha);assert.equal(result.planSha256,migration.sha256);results[id]=result;}
  let checks:string[]=[];
  if(mode==='rehearse'){
   for(const id of ids)assert((await registry[id as keyof typeof registry].apply(pool,target,backupSha)).alreadyApplied);
   checks.push('registered migration repeat idempotency');
   if(ids.includes('business-simplification'))checks.push(...await rehearseBusinessSimplification(pool));
   if(ids.includes('fabric-number-nonempty'))checks.push(...await rehearseFabricNumbers(pool));
   if(ids.includes('pattern-number-reuse'))checks.push(...await rehearsePatternNumberReuse(pool));
   if(ids.includes('pattern-deletion'))checks.push(...await rehearsePatternDeletion(pool));
   if(ids.includes('fabric-deletion'))checks.push(...await rehearseFabricDeletion(pool));
   if(ids.includes('customer-v12'))checks.push(...await rehearseCustomerV12(pool,target));
   if(ids.includes('light-customers'))checks.push(...await rehearseCustomers(pool));
  }
  console.log(JSON.stringify({mode,database,plans,results,checks}));
 }finally{await pool.end();}
}
main().catch((e:any)=>{console.error(JSON.stringify({failed:true,name:e.name,code:e.code??null,status:e.status??null,message:e.message}));process.exitCode=1;});

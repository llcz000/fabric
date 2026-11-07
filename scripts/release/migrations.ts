import {migrateSampleContactIdentity,SAMPLE_CONTACT_IDENTITY_PLAN_SHA256,verifySampleContactIdentitySchema} from '../../server/customer-samples/sessionContactIdentitySchema';
import {migrateSampleContact,SAMPLE_CONTACT_PLAN_SHA256,verifySampleContactSchema} from '../../server/customer-samples/sessionContactSchema';
import {migrateSampleCardReview,SAMPLE_CARD_REVIEW_PLAN_SHA256,verifySampleCardReviewSchema} from '../../server/customer-samples/sessionCardReviewSchema';
import {inventoryProductCards,migrateProductCards,PRODUCT_CARDS_PLAN_SHA256} from '../../server/customer-samples/productCardBackfill';
import {migrateModelGallery,MODEL_GALLERY_PLAN_SHA256,verifyModelGallerySchema} from '../../server/product-master/modelGallerySchema';
import {migratePatternDimensions,PATTERN_DIMENSIONS_PLAN_SHA256} from '../../server/product-master/patternDimensionsSchema';
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
 'sample-contact-identity':{sha256:SAMPLE_CONTACT_IDENTITY_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateSampleContactIdentity(p,t,b)},
 'sample-contact':{sha256:SAMPLE_CONTACT_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateSampleContact(p,t,b)},
 'sample-card-review':{sha256:SAMPLE_CARD_REVIEW_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateSampleCardReview(p,t,b)},
 'model-gallery':{sha256:MODEL_GALLERY_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateModelGallery(p,t,b)},
 'pattern-dimensions':{sha256:PATTERN_DIMENSIONS_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migratePatternDimensions(p,t,b)},
 'product-auto-cards':{sha256:PRODUCT_CARDS_PLAN_SHA256,apply:(p:any,t:any,b:string)=>migrateProductCards(p,t,b)},
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
 assert(['migrate','rehearse','plans','inventory'].includes(mode));
 const ids=rawIds?.split(',')??[];assert(ids.length&&new Set(ids).size===ids.length&&ids.every(x=>Object.hasOwn(registry,x)));
 const plans=Object.fromEntries(ids.map(id=>[id,registry[id as keyof typeof registry].sha256]));
 if(mode==='plans'){console.log(JSON.stringify(plans));return;}
 assert(/^[A-Za-z0-9_]{1,64}$/.test(database));assert(/^[a-f0-9-]{36}$/.test(serverUuid));if(mode!=='inventory')assert(/^[a-f0-9]{64}$/.test(backupSha));
 if(mode==='rehearse')assert(/^fabric_release_check_[a-f0-9]{16}$/.test(database));else assert.equal(database,'fabric_db');
 const pool=mysql.createPool({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,connectionLimit:3});
 try{
  const target={database,serverUuid},results:Record<string,unknown>={};
  if(mode==='inventory'){assert.deepEqual(ids,['product-auto-cards']);const [identity]:any=await pool.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');assert.equal(identity[0]?.database_name,database);assert.equal(identity[0]?.server_uuid,serverUuid);console.log(JSON.stringify(await inventoryProductCards(pool)));return;}
  for(const id of ids){const migration=registry[id as keyof typeof registry];const result=await migration.apply(pool,target,backupSha);assert.equal(result.planSha256,migration.sha256);results[id]=result;}
  let checks:string[]=[];
  if(mode==='rehearse'){
   for(const id of ids)assert((await registry[id as keyof typeof registry].apply(pool,target,backupSha)).alreadyApplied);
   checks.push('registered migration repeat idempotency');
   if(ids.includes('sample-contact-identity')){await verifySampleContactIdentitySchema(pool);checks.push('sample contact identity column verified');}
   if(ids.includes('sample-contact')){await verifySampleContactSchema(pool);checks.push('sample contact nullable snapshot verified; repeat migration idempotent');}
   if(ids.includes('sample-card-review')){await verifySampleCardReviewSchema(pool);checks.push('sample card review nullable JSON verified; migration repeat idempotent');}
   if(ids.includes('model-gallery')){await verifyModelGallerySchema(pool);checks.push('model gallery columns, unique asset, index contract verified; migration idempotent');}
   if(ids.includes('pattern-dimensions')){
    const conn=await pool.getConnection();
    try{await conn.beginTransaction();const [before]:any=await conn.query('SELECT id,width_cm,height_cm FROM pattern_masters ORDER BY id LIMIT 1 FOR UPDATE');
     if(before.length){await conn.query('UPDATE pattern_masters SET width_cm=?,height_cm=? WHERE id=?',[47.5,31.25,before[0].id]);const [saved]:any=await conn.query('SELECT width_cm,height_cm FROM pattern_masters WHERE id=?',[before[0].id]);assert.equal(Number(saved[0].width_cm),47.5);assert.equal(Number(saved[0].height_cm),31.25);}
     await conn.rollback();checks.push('nullable decimal master dimensions accept exact width and height; rehearsal changes rolled back');
    }finally{conn.release();}
   }
   if(ids.includes('product-auto-cards')){assert.equal((await inventoryProductCards(pool)).missing,0);checks.push('all current product groups have cards; repeat migration preserves IDs and QR');}
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

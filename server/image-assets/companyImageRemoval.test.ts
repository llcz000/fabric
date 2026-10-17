import test from 'node:test';
import assert from 'node:assert/strict';
import {MySqlAssetRepository} from './mysqlRepository';
test('explicit removal clears the legacy fallback in the same association transaction, including legacy-only image',async()=>{
 for(const linked of [false,true]){
  let legacy:string|null='legacy-qr-A',association:string|null=linked?'asset-B':null,commits=0;const calls:string[]=[];
  const db={async beginTransaction(){},async commit(){commits++;},async rollback(){},release(){},async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{calls.push(sql);
   if(sql.includes('FROM company_config'))return [[{id:1}],[]];
   if(sql.startsWith('UPDATE company_config SET wechat_qr')){legacy=null;return [{affectedRows:1},[]];}
   if(sql.startsWith('SELECT')&&sql.includes('FROM company_image_assets'))return [association?[{asset_id:association}]:[],[]];
   if(sql.includes('FROM image_assets')&&sql.includes('FOR UPDATE'))return [[{id:'asset-B',status:'ready',ref_count:1}],[]];
   if(sql.startsWith('DELETE FROM company_image_assets'))association=null;
   return [{affectedRows:1},[]];
  }};
  const repo=new MySqlAssetRepository({query:db.query,async getConnection(){return db;}} as any);
  await repo.replaceCompanyImage(1,'wechat_qr',null);assert.equal(legacy,null);assert.equal(association,null);assert.equal(commits,1);
  assert(!calls.some(q=>q.startsWith('DELETE FROM image_assets')),'only references removed; no asset objects/data purged');
 }
});

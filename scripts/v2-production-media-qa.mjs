/** Real COS fixtures on the restored candidate ONLY. No object deletes or production SQL. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import sharp from 'sharp';
dotenv.config({quiet:true,override:true});
assert.equal(process.env.FABRIC_V2_QA_ACK,'WRITE_RESTORED_REHEARSAL_ONLY');assert.match(process.env.DB_DATABASE??'',/^fabric_v2_test_release_[a-z0-9]+$/);
const db=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:process.env.DB_DATABASE});
const [[identity]]=await db.query('SELECT DATABASE() AS db,@@server_uuid AS uuid');assert.equal(identity.db,process.env.FABRIC_V2_EXPECTED_DATABASE);assert.equal(identity.uuid,process.env.FABRIC_V2_EXPECTED_UUID);
const base='http://127.0.0.1:3001',checks=[];let stage='login',token='';
const request=(url,method='GET',body)=>fetch(base+url,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(url,method='GET',body,status=200){const response=await request(url,method,body);assert.equal(response.status,status,method+' '+url);return response.json();}
async function upload(purpose){
 const body=await sharp({create:{width:64,height:64,channels:3,background:'#'+randomBytes(3).toString('hex')}}).png().toBuffer();
 const grant=await json('/api/image-assets/upload-sessions','POST',{purpose,originalFilename:'generated-rehearsal.png',declaredMime:'image/png',declaredByteSize:body.length},201);
 assert(!Object.keys(grant.headers).some(k=>k.toLowerCase()==='authorization'));
 const put=await fetch(grant.uploadUrl,{method:grant.method,headers:grant.headers,body});assert(put.ok,'real signed COS upload failed');
 const finalized=await json('/api/image-assets/upload-sessions/'+grant.sessionId+'/finalize','POST',{});const id=finalized.assetId??finalized.id;
 for(let i=0;i<35;i++){
  const response=await request('/api/image-assets/'+id);if(response.ok){const ready=await response.json();assert.equal(ready.status,'ready');return id;}
  assert.equal(response.status,409);await new Promise(r=>setTimeout(r,1000));
 }
 throw Error('Image processing did not become ready');
}
try{
 const login=await json('/api/v2/access/login','POST',{username:'admin',password:process.env.ADMIN_PASSWORD});token=login.token;
 const fixture=JSON.parse(await readFile('candidate-http-qa-result.json','utf8')).fixture,product=await json('/api/v2/products/'+fixture.product);
 stage='real COS upload';const image=await upload('product_image');checks.push('actual private COS signed PUT/finalize/worker ready');
 const details=await upload('product_image'),effect=await upload('product_image');
 await json('/api/v2/pattern-colorways/'+product.patternColorwayId,'PATCH',{patternImageAssetId:image});
 await json('/api/v2/products/'+product.id,'PATCH',{expectedRowVersion:product.rowVersion,images:{fabricDisplay:[image],detail:[details],aiEffect:[effect]}});
 const saved=await json('/api/v2/products/'+product.id);assert.deepEqual(saved.images,{fabricDisplay:[image],detail:[details],aiEffect:[effect]});checks.push('pattern and all three product image roles persist in real SQL');
 stage='COS preview';const urls=await json('/api/image-assets/access-urls','POST',{requests:[{assetId:image,variant:'thumbnail'},{assetId:image,variant:'original'}]});
 for(const value of urls.results){assert.equal(new URL(value.url).protocol,'https:');const response=await fetch(value.url);assert.equal(response.status,200);assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width,value.variant==='thumbnail'?320:64);}
 checks.push('actual signed thumbnail and original GET yield the generated raster');
 stage='shared reference';const master=await json('/api/v2/pattern-masters','POST',{masterNo:'QASHARE'+Date.now()},201);
 const colorway=await json('/api/v2/pattern-masters/'+master.id+'/colorways','POST',{remark:'shared image rehearsal'},201);
 await json('/api/v2/pattern-colorways/'+colorway.id,'PATCH',{patternImageAssetId:image});
 await json('/api/v2/pattern-colorways/'+product.patternColorwayId,'PATCH',{patternImageAssetId:null});
 const [[references]]=await db.query('SELECT ref_count,status FROM image_assets WHERE id=?',[image]);assert.equal(Number(references.ref_count),2);assert.equal(references.status,'ready');
 await json('/api/image-assets/access-urls','POST',{requests:[{assetId:image,variant:'original'}]});checks.push('unlinking one of three real references retains the shared asset and access');
 const result={passed:checks.length,checks,fixture:{product:product.id,sharedMaster:master.id,asset:image},productionDatabaseChanged:false,objectsDeleted:false};
 await writeFile('candidate-media-qa-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({stage,passed:checks.length,error:error instanceof Error?error.message:'failed'}));process.exitCode=1;}
finally{await db.end();}

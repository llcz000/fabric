import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewFetch,reviewFacts} from './mockApi';
test('P4-6 visual fixture is offline and unknown API path fails closed',async()=>{
 const summary=reviewFacts();
 assert(summary.offline&&summary.masters>=5&&summary.colorways>=20&&summary.fabrics>=20&&summary.products>=15);
 const response=await reviewFetch('/api/remote/production');
 assert.equal(response.status,404);
 assert.equal((await response.json()).error,'LOCAL_REVIEW_UNSUPPORTED_PATH');
});
test('P4-6 isolated pattern, fabric, product fixture follow page DTO shapes',async()=>{
 const a=await reviewFetch('/api/v2/pattern-catalog?limit=20&offset=0');
 const b=await reviewFetch('/api/v2/fabrics/catalog?limit=50&offset=0');
 const c=await reviewFetch('/api/v2/products?status=active&limit=50&offset=0');
 assert([a,b,c].every(x=>x.status===200));
 const p=await a.json(),f=await b.json(),pr=await c.json();
 assert(p.items[0].versions.length>=5&&f.items[0].productCount>0&&pr.items[0].imageCounts.detail===1);
 assert.deepEqual(pr.items[0].imageCounts,{fabricDisplay:1,detail:1,aiEffect:1});
 assert.equal(pr.items[0].totalImages,3);
 const tags=await reviewFetch('/api/v2/tags?dimension=topic');
 assert((await tags.json()).items.every((x:{dimension:string})=>x.dimension==='topic'));
});
test('P4-6 mock cannot fake ready COS or signed links',async()=>{
 const signed=await reviewFetch('/api/image-assets/access-urls',{method:'POST',
  body:JSON.stringify({requests:[{assetId:'a1111111-1111-4111-8111-111111111111',variant:'thumbnail'}]})});
 assert.deepEqual(await signed.json(),{results:[]});
});
test('P4-6 combined colorway POST/PATCH mock stores tagIds with the same version',async()=>{
 const add=await reviewFetch('/api/v2/pattern-masters/101/colorways',{
  method:'POST',body:JSON.stringify({remark:'暖色',isActive:true,tagIds:['12']})
 });
 assert.equal(add.status,201);
 const created=await add.json();
 assert.deepEqual(created.colorTags.map((x:{id:string})=>x.id),['12']);
 const edit=await reviewFetch('/api/v2/pattern-colorways/'+created.id,{
  method:'PATCH',body:JSON.stringify({remark:'改色',isActive:true,tagIds:['11','13']})
 });
 const updated=await edit.json();
 assert.equal(updated.remark,'改色');
 assert.deepEqual(updated.colorTags.map((x:{id:string})=>x.id),['11','13']);
});

test('P5 isolated review fixture previews and commits only fake XLSX data after confirmation',async()=>{
 const payload=JSON.stringify({fileBase64:'UEsDBAAAAA==',options:{filename:'fabric-qa.xlsx'}});
 const preview=await reviewFetch('/api/v2/fabrics/import/preview',{
  method:'POST',body:payload});
 assert.equal(preview.status,200);
 const data=await preview.json();
 assert.equal(data.rows.length,5);
 assert.deepEqual(data.counts,{create:1,skip:3,error:1});
 assert.equal(data.rows[0].existing.fabricNo,'F018');
 const noCommit=await reviewFetch('/api/v2/fabrics/import/commit',{
  method:'POST',body:JSON.stringify({token:data.token,confirm:false,updateRows:[2]})});
 assert.equal(noCommit.status,400);
 const result=await reviewFetch('/api/v2/fabrics/import/commit',{
  method:'POST',body:JSON.stringify({token:data.token,confirm:true,updateRows:[2]})});
 assert.equal(result.status,200);
 assert.deepEqual((await result.json()).counts,{created:1,updated:1,skipped:2,failed:1});
 const replay=await reviewFetch('/api/v2/fabrics/import/commit',{
  method:'POST',body:JSON.stringify({token:data.token,confirm:true,updateRows:[2]})});
 assert.equal(replay.status,409);
 const list=await reviewFetch('/api/v2/fabrics/catalog?query=F777');
 assert.equal((await list.json()).items.length,1);
});
test('P4-6 fabric edit only updates in-memory fixture',async()=>{
 const list=await reviewFetch('/api/v2/fabrics/catalog?limit=5');
 const first=(await list.json()).items[0];
 const res=await reviewFetch('/api/v2/fabrics/'+first.id,{method:'PATCH',
  body:JSON.stringify({fabricNo:first.fabricNo,fabricName:'浏览器验收标记',composition:null,weightValue:null,
   weightUnit:null,widthValue:null,remark:null,isActive:true})});
 assert.equal(res.status,200);
 const updated=await reviewFetch('/api/v2/fabrics/catalog?query='+encodeURIComponent('浏览器验收标记'));
 assert.equal((await updated.json()).items[0].fabricName,'浏览器验收标记');
});

test('EX local review exports matching current metadata rather than the current page or image data',async()=>{
 const {default:ExcelJS}=await import('exceljs');
 for(const [url,first] of [
  ['/api/v2/fabrics/catalog/export.xlsx?query=F018&limit=1&offset=99','F018'],
  ['/api/v2/pattern-catalog/export.xlsx?number=G0180&offset=20','G0180'],
  ['/api/v2/products/export.xlsx?productNo=G0180-2-F019&offset=20','G0180-2-F019']
 ]){
  const response=await reviewFetch(url);assert.equal(response.status,200);
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(book.worksheets[0].rowCount,2);assert.equal(book.worksheets[0].getCell('A2').value,first);
  assert.equal(book.model.media?.length??0,0);
 }
});

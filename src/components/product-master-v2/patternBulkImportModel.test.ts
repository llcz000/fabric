import assert from 'node:assert/strict';
import test from 'node:test';
import {parsePatternImageFilename,planPatternImageImports,saveImportedPatternImage,deleteWholePatternMaster} from './patternBulkImportModel';

const file=(name:string,type='image/jpeg',size=123)=>({name,type,size} as File);
test('bulk image filename extracts immutable master and numeric colorway',()=>{
 assert.deepEqual(parsePatternImageFilename(file('G0008-1.jpg')),{masterNo:'G0008',colorwayNo:1,patternNo:'G0008-1'});
 assert.deepEqual(parsePatternImageFilename(file('g0008-12.PNG','image/png')),{masterNo:'G0008',colorwayNo:12,patternNo:'G0008-12'});
 for(const name of ['G0008.jpg','G0008-.jpg','G0008-0.jpg','G0008-01.jpg','G0008-4294967296.jpg','G0008-1.txt','G0008-1-2.jpg','A_B-1.jpg'])
  assert.throws(()=>parsePatternImageFilename(file(name)),/文件名|格式|配色/);
 assert.throws(()=>parsePatternImageFilename(file('G0008-1.jpg','image/jpeg',0)),/20MB/);
 assert.throws(()=>parsePatternImageFilename(file('G0008-1.jpg','image/jpeg',21*1024*1024)),/20MB/);
 assert.throws(()=>parsePatternImageFilename(file('G0008-1.jpg','image/png')),/格式/);
});
test('batch is ordered by immutable number and every conflicting image is rejected',()=>{
 const plan=planPatternImageImports([file('G0008-3.jpg'),file('G0008-1.jpg'),file('g0008-1.jpeg'),file('bad.png','image/png'),file('G0008-2.jpg')]);
 assert.deepEqual(plan.ready.map(x=>x.patternNo),['G0008-2','G0008-3']);
 assert.equal(plan.rejected.length,3);
 assert.match(plan.rejected[0].error,/重复/);
});
test('nested folder names are only local display and every cross-folder identity conflict is rejected',()=>{
 const nested=(name:string,path:string,type='image/jpeg')=>({...file(name,type),webkitRelativePath:path} as File);
 const plan=planPatternImageImports([
  nested('G0008-1.jpg','batch/blue/G0008-1.jpg'),
  nested('g0008-1.PNG','batch/red/g0008-1.PNG','image/png'),
  nested('H0001-2.jpg','batch/blue/deep/H0001-2.jpg'),
 ]);
 assert.deepEqual(plan.ready.map(x=>x.patternNo),['H0001-2']);
 assert.deepEqual(plan.rejected.map(x=>x.name),['batch/blue/G0008-1.jpg','batch/red/g0008-1.PNG']);
 assert.deepEqual(plan.rejected.map(x=>x.identity?.patternNo),['G0008-1','G0008-1']);
});
test('an invalid image cannot silently resolve a same-number conflict or change filename identity',()=>{
 const first={...file('G0008-1.jpg'),webkitRelativePath:'G9999-9/bad/G0008-1.jpg'} as File;
 assert.deepEqual(parsePatternImageFilename(first),{masterNo:'G0008',colorwayNo:1,patternNo:'G0008-1'});
 const plan=planPatternImageImports([first,file('g0008-1.jpeg','image/jpeg',0),file('H0001-1.jpg')]);
 assert.deepEqual(plan.ready.map(x=>x.patternNo),['H0001-1']);assert.equal(plan.rejected.length,2);
});
test('bulk client uploads first, then persists explicit number with exactly one POST; never retries ambiguous commits',async()=>{
 const calls:string[]=[];
 const api=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push(String(url));assert.equal(init?.method,'POST');
  assert.deepEqual(JSON.parse(String(init?.body)),{masterNo:'G0008',colorwayNo:1,patternImageAssetId:'a1111111-1111-4111-8111-111111111111'});
  return new Response(JSON.stringify({patternNo:'G0008-1'}),{status:201});
 }) as typeof fetch;
 await saveImportedPatternImage(api,async()=>{calls.push('image-upload');return 'a1111111-1111-4111-8111-111111111111';},
  {...parsePatternImageFilename(file('G0008-1.jpg')),file:file('G0008-1.jpg')});
 assert.deepEqual(calls,['image-upload','/api/v2/pattern-catalog/import']);
});
test('delete master uses exact ID and no automatic retries; 409 gives association guidance',async()=>{
 const calls:string[]=[];
 const api=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push(String(url)+' '+init?.method);
  return new Response(JSON.stringify({error:'Pattern master is referenced'}),{status:409});
 }) as typeof fetch;
 await assert.rejects(deleteWholePatternMaster(api,'12'),/关联/);
 assert.deepEqual(calls,['/api/v2/pattern-masters/12 DELETE']);
 await assert.rejects(deleteWholePatternMaster(api,'0'),/无效/);
 assert.equal(calls.length,1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createLibraryPattern,savePatternDraft,type PatternCreationProgress} from './patternCreateModel';
test('pattern creation normalizes the number, sends only its owned fields and returns persisted identity',async()=>{
 let calls=0;const fetcher=(async(url,init)=>{calls++;assert.equal(url,'/api/v2/pattern-masters');assert.deepEqual(JSON.parse(String(init?.body)),{masterNo:'AB123'});return new Response(JSON.stringify({id:'7',masterNo:'AB123'}),{status:201});}) as typeof fetch;
 assert.equal((await createLibraryPattern(fetcher,' ab123 ')).id,'7');assert.equal(calls,1);
 await assert.rejects(createLibraryPattern(fetcher,'非法编号'));assert.equal(calls,1);
});
test('subject-only creation does not write removed color labels',async()=>{
 const calls:string[]=[];
 const api=(async(url,init)=>{
  calls.push(String(url));
  if(url==='/api/v2/pattern-masters')return Response.json({id:'7',masterNo:'AB'});
  if(url==='/api/v2/pattern-masters/7/tags')return Response.json({tagIds:['3']});
  if(String(url).endsWith('/colorways'))return Response.json({id:'8',masterId:'7',masterNo:'AB',colorwayNo:1,patternNo:'AB-1',patternImageAssetId:null,remark:'',isActive:true});
  throw Error('unexpected write '+url);
 }) as typeof fetch;
 const saved=await savePatternDraft(api,'AB',[{key:'1',remark:''}],{}, {topicTagIds:['3']});
 assert.equal(saved.masterNo,'AB');
 assert(!calls.some(url=>url.endsWith('/color-tags')));
});
test('duplicate failure does not pretend creation succeeded',async()=>{
 await assert.rejects(createLibraryPattern(async()=>new Response('{}',{status:409}),'A1'),/已存在/);
});

test('creation saves master topic/color selections before colorways and resumes after a rejected tag save',async()=>{
 const calls:{url:string;body:any}[]=[],progress:PatternCreationProgress={};let fail=true;
 const api=(async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});
 if(url==='/api/v2/pattern-masters')return Response.json({id:'7',masterNo:'AB'});
 if(String(url).endsWith('/color-tags')){if(fail)return Response.json({},{status:400});return Response.json({tagIds:['4','5']});}
 if(String(url).endsWith('/tags'))return Response.json({});
 return Response.json({id:'8',masterId:'7',masterNo:'AB',colorwayNo:1,patternNo:'AB-1',patternImageAssetId:null,remark:'',isActive:true});}) as typeof fetch;
 const tags={topicTagIds:['3'],colorTagIds:['4'],newColorTags:['海盐蓝']};
 await assert.rejects(savePatternDraft(api,'AB',[{key:'a',remark:''}],progress,tags));
 assert.equal(calls.filter(c=>c.url==='/api/v2/pattern-masters').length,1);assert(!calls.some(c=>c.url.endsWith('/colorways')));assert.equal(progress.uncertain,false);
 fail=false;tags.colorTagIds=['6'];tags.newColorTags=[];await savePatternDraft(api,'AB',[{key:'a',remark:''}],progress,tags);
 assert.deepEqual(calls.find(c=>c.url.endsWith('/tags'))?.body,{tagIds:['3']});
 assert.deepEqual(calls.find(c=>c.url.endsWith('/color-tags'))?.body,{tagIds:['4'],newColorTags:['海盐蓝']});
 assert.deepEqual(calls.filter(c=>c.url.endsWith('/color-tags')).at(-1)?.body,{tagIds:['6'],newColorTags:[]});
 assert.equal(calls.filter(c=>c.url.endsWith('/tags')).length,1);assert.equal(calls.filter(c=>c.url==='/api/v2/pattern-masters').length,1);assert.equal(calls.filter(c=>c.url.endsWith('/colorways')).length,1);
});

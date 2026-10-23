import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TOPIC_PRESETS,ensureTopicTag,sortedTopicTags,previewCustomTopicDeletion,deleteCustomTopic,resolvePresetTopicForFilter} from './topicCatalog';
import {TopicTagPicker} from './TopicTagPicker';

test('16 canonical topics are visible even when the persistent dictionary is empty; custom entry remains available',()=>{
 const html=renderToStaticMarkup(React.createElement(TopicTagPicker,{
  apiFetch:fetch,options:[],selected:[],onChange:()=>{},ariaLabel:'内部题材'
 }));
 for(const name of TOPIC_PRESETS)assert(html.includes(name));
 assert(html.includes('自定义题材'));assert(html.includes('添加题材'));
 assert(!html.includes('颜色标签'));
});
test('existing topic IDs remain stable and need no POST',async()=>{
 let requested=0;
 const chosen={id:'51',name:'小碎花',isArchived:false};
 const value=await ensureTopicTag((async()=>{requested++;throw Error('should not request');}) as typeof fetch,[chosen],' 小碎花 ');
 assert.equal(value.id,'51');assert.equal(requested,0);
});
test('custom and missing preset topics create through authenticated shared-tag API',async()=>{
 const calls:{path:string;body:unknown}[]=[];
 const api=(async(path:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({path:String(path),body:JSON.parse(String(init?.body))});
  return new Response(JSON.stringify({id:'128',dimension:'topic',name:'油画花卉',isArchived:false}),{status:201});
 }) as typeof fetch;
 const created=await ensureTopicTag(api,[],'油画花卉');
 assert.equal(created.id,'128');
 assert.deepEqual(calls,[{path:'/api/v2/tags',body:{dimension:'topic',name:'油画花卉'}}]);
});
test('preset filter uses existing archived ID for history or creates an unseeded preset on demand',async()=>{
 const requests:string[]=[];
 const api=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  requests.push((init?.method??'GET')+' '+String(input));
  if(!init?.method)return new Response(JSON.stringify({items:[{id:'89',name:'波点',dimension:'topic',isArchived:true}]}),{status:200});
  throw Error('filter must not create archived preset');
 }) as typeof fetch;
 const historical=await resolvePresetTopicForFilter(api,[],'波点');
 assert.deepEqual(historical,{id:'89',name:'波点',isArchived:true});
 assert.deepEqual(requests,['GET /api/v2/tags?dimension=topic&includeArchived=true&search='+encodeURIComponent('波点')]);
});
test('custom topic deletion sends exact impact count to atomic unlink endpoint',async()=>{
 const calls:string[]=[];
 const api=(async(path:RequestInfo|URL,init?:RequestInit)=>{
  calls.push((init?.method??'GET')+' '+String(path));
  if(!init?.method)return new Response(JSON.stringify({id:'3',name:'我的手绘涂鸦',dimension:'topic',isArchived:false,affectedCount:2}),{status:200});
  return new Response(JSON.stringify({id:'3',name:'我的手绘涂鸦',dimension:'topic',isArchived:true,affectedCount:2}),{status:200});
 }) as typeof fetch;
 const tag={id:'3',name:'我的手绘涂鸦',isArchived:false};
 assert.equal((await previewCustomTopicDeletion(api,tag)).affectedCount,2);
 assert.equal((await deleteCustomTopic(api,tag,2)).isArchived,true);
 assert.deepEqual(calls,['GET /api/v2/tags/3/impact','POST /api/v2/tags/3/delete']);
 await assert.rejects(previewCustomTopicDeletion(api,{id:'1',name:'条纹',isArchived:false}),/预设/);
});
test('old archived custom topic can preview impact and submit global unlink',async()=>{
 const tag={id:'61',name:'旧版手绘',isArchived:true};
 const api=(async(_url:RequestInfo|URL,opts?:RequestInit)=>new Response(JSON.stringify({id:tag.id,name:tag.name,dimension:'topic',isArchived:true,affectedCount:3}),{status:200})) as typeof fetch;
 assert.equal((await previewCustomTopicDeletion(api,tag)).affectedCount,3);
 assert.equal((await deleteCustomTopic(api,tag,3)).isArchived,true);
});
test('historical and archived custom topics remain visible without being silently deleted',()=>{
 const options=[{id:'1',name:'历史题材',isArchived:true},{id:'3',name:'波点',isArchived:false}];
 assert.deepEqual(sortedTopicTags(options).map(x=>x.name),['波点','历史题材']);
 const html=renderToStaticMarkup(React.createElement(TopicTagPicker,{
  apiFetch:fetch,options,selected:['1'],onChange:()=>{},ariaLabel:'内部题材'
 }));
 assert(html.includes('历史题材'));assert(html.includes('波点'));
});

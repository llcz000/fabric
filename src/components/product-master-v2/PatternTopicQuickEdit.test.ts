import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CatalogTag} from './catalogModel';
import type {PatternMasterItem} from './patternModel';
import {PatternTopicQuickEdit,toggleQuickTopic,persistQuickTopics} from './PatternTopicQuickEdit';

const master:PatternMasterItem={id:'11',masterNo:'G0008',isActive:true,nextColorwayNo:2,
 topicTags:[{id:'5',name:'条纹',isArchived:false}],colorTags:[],versions:[]};
const existing:CatalogTag[]=[{id:'5',name:'条纹',isArchived:false},{id:'7',name:'几何图案',isArchived:false}];

test('row quick editor renders fixed and custom labels, staged selection, save and cancel',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternTopicQuickEdit,{
  master,topics:existing,apiFetch:fetch,onSaved:()=>{},onCancel:()=>{}
 }));
 assert(html.includes('直接修改题材 G0008'));
 assert(html.includes('保存题材')&&html.includes('取消'));
 assert(html.includes('输入新的题材'));
 assert(html.includes('预设题材')&&html.includes('条纹'));
 assert(html.includes('aria-pressed="true"'));
});
test('quick edit stages addition and removal without API calls; max 10 total',()=>{
 const start={tagIds:['5'],newNames:[]};
 const withGeometry=toggleQuickTopic(start,{id:'7',name:'几何图案'});
 assert.deepEqual(withGeometry.tagIds,['5','7']);
 const removed=toggleQuickTopic(withGeometry,{id:'5',name:'条纹'});
 assert.deepEqual(removed.tagIds,['7']);
 const staged=toggleQuickTopic(removed,{name:'油画花卉'});
 assert.deepEqual(staged.newNames,['油画花卉']);
 assert.deepEqual(toggleQuickTopic(staged,{name:'油画花卉'}).newNames,[]);
 assert.throws(()=>toggleQuickTopic({tagIds:Array.from({length:10},(_,i)=>String(i+1)),newNames:[]},{name:'涂鸦'}),/10/);
});
test('quick topic save persists association exactly once and defers creating missing presets until save',async()=>{
 const calls:{path:string;method:string;body?:unknown}[]=[];
 const fake=(async(path:RequestInfo|URL,init:RequestInit={})=>{
  const body=init.body?JSON.parse(String(init.body)):undefined;
  calls.push({path:String(path),method:init.method??'GET',body});
  if(String(path)==='/api/v2/tags')return new Response(JSON.stringify({id:'88',name:'油画花卉',dimension:'topic',isArchived:false}),{status:201});
  if(String(path)==='/api/v2/pattern-masters/11/tags')return new Response(JSON.stringify({tagIds:body.tagIds}),{status:200});
  throw Error('Unexpected API path');
 }) as typeof fetch;
 assert.equal(calls.length,0);
 const result=await persistQuickTopics(fake,'11',existing,{tagIds:['7'],newNames:['油画花卉']});
 assert.deepEqual(result.ids,['7','88']);
 assert.deepEqual(calls.map(v=>v.method+' '+v.path),['POST /api/v2/tags','PUT /api/v2/pattern-masters/11/tags']);
 assert.deepEqual(calls[1].body,{tagIds:['7','88']});
});
test('quick topic save with existing choices avoids tag creation and server failures do not report success',async()=>{
 const calls:string[]=[];
 const fake=(async(path:RequestInfo|URL,init:RequestInit={})=>{
  calls.push(init.method+' '+path);
  return new Response(JSON.stringify({error:'revoked'}),{status:403});
 }) as typeof fetch;
 await assert.rejects(persistQuickTopics(fake,'11',existing,{tagIds:[],newNames:[]}),/HTTP 403/);
 assert.deepEqual(calls,['PUT /api/v2/pattern-masters/11/tags']);
});

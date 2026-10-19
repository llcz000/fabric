import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeDefaultTags,DEFAULT_TAGS} from './lib/v2-default-tags.mjs';
test('defaults initialize idempotently and preserve custom/archived names without reactivation',async()=>{
 const tags={topic:[{name:'花卉',isArchived:true},{name:'自定义',isArchived:false}],color:[]};let writes=0;
 const api=async(url,init)=>{const dimension=new URL(url,'http://localhost').searchParams.get('dimension');
  if(!init)return Response.json({items:tags[dimension]});
  const body=JSON.parse(init.body);writes++;tags[body.dimension].push({name:body.name,isArchived:false});return Response.json({id:String(writes)});
 };
 await initializeDefaultTags(api);assert.equal(writes,25);await initializeDefaultTags(api);assert.equal(writes,25);
 assert.equal(tags.topic[0].isArchived,true);assert.equal(DEFAULT_TAGS.topic.length,11);assert.equal(DEFAULT_TAGS.color.length,15);
});

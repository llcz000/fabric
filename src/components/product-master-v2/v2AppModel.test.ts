import assert from 'node:assert/strict';
import test from 'node:test';
import {parseV2AppPrincipal,v2AuthenticatedFetch,mapV2Company} from './v2AppModel';
test('real app rejects unknown/legacy identity and does not invent a company fallback',()=>{
 assert.throws(()=>parseV2AppPrincipal({id:'1',role:'superadmin'}));
 assert.equal(parseV2AppPrincipal({id:'7',role:'sales',username:'sales',displayName:'业务员'}).role,'sales');
 assert.throws(()=>mapV2Company(null));
 assert.equal(mapV2Company({company_name:'当前公司',address:'地址',phone:'电话',default_terms:'条款',deposit_terms:'定金'}).name,'当前公司');
});
test('V2 bearer only reaches same-origin approved relative API and 401 invalidates identity',async()=>{
 let calls=0,invalidated=0;const transport=v2AuthenticatedFetch(async(input,init)=>{calls++;assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+'a'.repeat(64));return new Response('{}',{status:401});},'a'.repeat(64),()=>invalidated++);
 await transport('/api/v2/access/me');assert.equal(calls,1);assert.equal(invalidated,1);
 for(const url of ['https://outside.invalid/api/v2','//outside.invalid/api','/api/../api','/api/%2e%2e','/uploads/anything'])await assert.rejects(transport(url));
 assert.equal(calls,1);
});
test('same-origin encoded Chinese search values are permitted without allowing encoded path traversal',async()=>{
 let seen='';const transport=v2AuthenticatedFetch(async input=>{seen=String(input);return new Response('{}');},'a'.repeat(64),()=>{});
 await transport('/api/v2/products?fabricName=%E6%A3%89%E5%B8%83');assert(seen.includes('%E6'));
});

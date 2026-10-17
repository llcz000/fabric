import assert from 'node:assert/strict';
import test from 'node:test';
import {createLibraryPattern} from './patternCreateModel';
test('pattern creation normalizes the number, sends only its owned fields and returns persisted identity',async()=>{
 let calls=0;const fetcher=(async(url,init)=>{calls++;assert.equal(url,'/api/v2/pattern-masters');assert.deepEqual(JSON.parse(String(init?.body)),{masterNo:'AB123'});return new Response(JSON.stringify({id:'7',masterNo:'AB123'}),{status:201});}) as typeof fetch;
 assert.equal((await createLibraryPattern(fetcher,' ab123 ')).id,'7');assert.equal(calls,1);
 await assert.rejects(createLibraryPattern(fetcher,'非法编号'));assert.equal(calls,1);
});
test('duplicate failure does not pretend creation succeeded',async()=>{
 await assert.rejects(createLibraryPattern(async()=>new Response('{}',{status:409}),'A1'),/已存在/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {copyPatternShareLink} from './copyPatternShareLink';

test('copy reports success only after the clipboard write resolves',async()=>{
 const writes:string[]=[];
 assert.equal(await copyPatternShareLink('https://example.test/p/token',{writeText:async value=>{writes.push(value);}},()=>assert.fail('manual fallback on success')),'copied');
 assert.deepEqual(writes,['https://example.test/p/token']);
});
test('missing clipboard, synchronous exceptions and denied writes select the manual fallback',async()=>{
 let selections=0;
 for(const clipboard of [undefined,{writeText:()=>{throw Error('unsupported');}},{writeText:async()=>{throw Error('denied');}}]){
  assert.equal(await copyPatternShareLink('https://example.test/p/token',clipboard,()=>{selections++;}),'manual');
 }
 assert.equal(selections,3);
});

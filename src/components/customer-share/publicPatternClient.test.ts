import test from 'node:test';import assert from 'node:assert/strict';
import {parsePublicPatternResponse,publicPatternImagePath,parsePatternShareLink} from './publicPatternClient';
const token='a'.repeat(43),ref='display:'+'b'.repeat(43);
test('public page accepts only explicit whitelist structure and opaque derived refs, never URLs/originals',()=>{
 const value={available:true,pattern:{patternNo:'1234',colorways:[{colorwayNumber:1,designImages:[{previewRef:ref}],fabrics:[]}]}};
 assert.equal(parsePublicPatternResponse(value)?.patternNo,'1234');assert.equal(parsePublicPatternResponse({available:false,message:'暂不可用'}),null);
 assert.throws(()=>parsePublicPatternResponse({...value,pattern:{...value.pattern,colorways:[{colorwayNumber:1,designImages:[{previewRef:'https://private/original.tif'}],fabrics:[]}]}}));
 assert.equal(publicPatternImagePath(token,ref),'/api/public/patterns/'+token+'/images/'+'b'.repeat(43));assert.throws(()=>publicPatternImagePath('../private',ref));
});
test('private share response provides a canonical HTTPS link and same-origin public preview path only',()=>{
 assert.deepEqual(parsePatternShareLink('https://124.223.97.60/p/'+token),{url:'https://124.223.97.60/p/'+token,path:'/p/'+token});
 for(const url of ['javascript:alert(1)','http://124.223.97.60/p/'+token,'https://user:pass@example.test/p/'+token,'https://example.test/p/'+token+'?source=secret'])assert.throws(()=>parsePatternShareLink(url));
});

import test from 'node:test';import assert from 'node:assert/strict';
import {resolvePatternShareRuntimeConfig} from './patternShareRuntimeConfig';
test('B1 runtime is opt-in; enabled mode requires explicit trusted HTTPS origin and separate key file',()=>{
 assert.equal(resolvePatternShareRuntimeConfig({}),null);
 for(const env of [{FABRIC_V2_PATTERN_SHARING:'true'},{FABRIC_V2_PATTERN_SHARING:'enabled'},{FABRIC_V2_PATTERN_SHARING:'enabled',FABRIC_V2_PUBLIC_ORIGIN:'http://124.223.97.60',FABRIC_V2_PATTERN_SHARE_KEY_FILE:'/etc/key'}])assert.throws(()=>resolvePatternShareRuntimeConfig(env));
 assert.deepEqual(resolvePatternShareRuntimeConfig({FABRIC_V2_PATTERN_SHARING:'enabled',FABRIC_V2_PUBLIC_ORIGIN:'https://124.223.97.60',FABRIC_V2_PATTERN_SHARE_KEY_FILE:'/etc/fabric-secrets/pattern-share-v1.key'}),{publicOrigin:'https://124.223.97.60',keyFile:'/etc/fabric-secrets/pattern-share-v1.key'});
});

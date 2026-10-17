import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

// Production runner uses the root's npm ci install; the local Windows worktree
// shares an OLD node_modules junction with master. A clean TEMP prefix can be
// supplied for SDK API smoke without changing the old service's dependencies.
const base=process.env.FABRIC_COS_SDK_TEST_ROOT ||
  resolve(fileURLToPath(new URL('..',import.meta.url)));
const requireFromInstall=createRequire(join(base,'v2-cos-sdk-contract.cjs'));
const SDK=requireFromInstall('cos-nodejs-sdk-v5');
const sdkPackage=requireFromInstall('cos-nodejs-sdk-v5/package.json');

test('COS SDK 3 runtime boundary retains legacy constructor, methods and Promise adapters',()=>{
 assert.equal(sdkPackage.version,'3.0.0');
 assert.equal(typeof SDK,'function');
 const sdk=new SDK({SecretId:'FAKE_TEST_ONLY_NOT_REAL',SecretKey:'FAKE_KEY_TEST_ONLY_NOT_REAL'});
 for(const method of ['getObjectUrl','headObject','getObject','putObject','deleteObject'])
  assert.equal(typeof sdk[method],'function','COS '+method+' required for image asset runtime');
 assert.equal(SDK.version,'3.0.0');
});

test('COS 3 produces local synchronous GET/PUT HTTPS signatures without network or real credentials',()=>{
 const sdk=new SDK({SecretId:'FAKE_TEST_ONLY_NOT_REAL',SecretKey:'FAKE_KEY_TEST_ONLY_NOT_REAL'});
 const common={Bucket:'fabric-v2-fixture-1250000000',Region:'ap-shanghai',
  Key:'quarantine/test-only/file.png',Sign:true,Expires:300,Protocol:'https:'};
 const get=sdk.getObjectUrl({...common,Method:'GET'});
 const put=sdk.getObjectUrl({...common,Method:'PUT'});
 for(const link of [get,put]){
  assert.equal(typeof link,'string');
  const url=new URL(link);
  assert.equal(url.protocol,'https:');
  assert.equal(url.hostname,'fabric-v2-fixture-1250000000.cos.ap-shanghai.myqcloud.com');
  assert.equal(url.pathname,'/quarantine/test-only/file.png');
  assert.equal(url.searchParams.has('q-signature'),true);
 }
 assert.notEqual(get,put,'Method must bind the upload/download signature');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {formatSampleCardScanUrl,readSampleCardScanToken} from './sampleCardScanLink';
import {readV2Route} from '../components/product-master-v2/v2Navigation';
import {createSampleOperationsClient} from '../components/product-master-v2/sampleOperationsModel';

const token='Stable_card_token_0123456789_AbCd';
const link='https://124.223.97.60/#/samples?scan=Stable_card_token_0123456789_AbCd';
test('direct card QR opens the app with a fragment and preserves the original token',()=>{
 assert.equal(formatSampleCardScanUrl('https://124.223.97.60',token),link);
 assert.equal(readSampleCardScanToken(link),token);
 assert.equal(readSampleCardScanToken(token),token);
 assert.equal(readSampleCardScanToken('#/cards?scan='+token),token);
});
test('card scans reject malformed links and alternate actions instead of treating arbitrary strings as tokens',()=>{
 for(const value of ['', 'short','https://evil.example/?scan='+token,'javascript:'+token,
  'https://124.223.97.60/#/cards?scan='+token+'&scan='+token,'#/cards?scan='+token+'&redirect=https://evil.example',
  'https://user:pass@124.223.97.60/#/cards?scan='+token,'#/products?scan='+token])assert.equal(readSampleCardScanToken(value),null,value);
 for(const origin of ['https://host.example/path','https://user:pass@host.example','javascript:foo','https://host.example/?x=1'])assert.throws(()=>formatSampleCardScanUrl(origin,token));
});
test('the existing selection API accepts a new URL QR and sends only the stable token to the authenticated scan endpoint',async()=>{
 const calls:{url:string;body:unknown}[]=[];
 const api=createSampleOperationsClient((async(url,init)=>{
  calls.push({url:String(url),body:JSON.parse(String(init?.body))});
  return Response.json({cardId:'11',addedProductIds:['21']});
 }) as typeof fetch);
 await api.scan('7',link);
 assert.deepEqual(calls,[{url:'/api/v2/sample-cards/scan',body:{sessionId:'7',cardToken:token}}]);
});

test('scanned cards land on customer selection, including links generated before the landing change',()=>{
 for(const hash of ['#/samples?scan='+token,'#/cards?scan='+token])assert.equal(readV2Route(hash).view,'samples');
 assert.equal(readV2Route('#/cards').view,'cards');
});

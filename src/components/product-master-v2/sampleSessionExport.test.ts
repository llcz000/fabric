import test from 'node:test';import assert from 'node:assert/strict';
import {downloadSessionCards,formatSampleSessionDate} from './sampleSessionExport';
test('export validates xlsx MIME, preserves current session identity and uses Shanghai date in readable filenames',async()=>{
 let url='';const result=await downloadSessionCards(async(input)=>{url=String(input);return new Response(new Uint8Array([80,75,3,4]),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});},{id:'41',customerReference:'林/女士',createdAt:'2026-10-26T07:30:00.000Z'});
 assert.equal(url,'/api/v2/customer-samples/sessions/41/cards/export.xlsx');assert.equal(result.filename,'林_女士_20261026_色卡.xlsx');assert.equal(formatSampleSessionDate({createdAt:'2026-10-26T07:30:00.000Z'}),'2026-10-26');
 for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response(null,{status:409})])await assert.rejects(downloadSessionCards(async()=>response,{id:'41',customerReference:'客户'}));
});

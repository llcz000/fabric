import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSelectedCards,loadCompleteSelection,resolveSelectionThumbnails} from './selectedCardModel';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
const item=(n:number,cardId='12',fabricNo='F018'):SampleSessionPage['items'][number]=>({id:String(n),productId:String(n),current:{productNo:`G0886-${n}-${fabricNo}`,patternNo:'G0886',colorwayNo:n,fabricNo,fabricName:'雪纺',composition:null,weightValue:'80',weightUnit:'gsm',widthCm:'145'},sources:[{cardId,cardNo:'G0886-'+fabricNo,retired:false,firstScanEventId:'1'}]});

test('thumbnail batches isolate missing assets and retain healthy results with bounded concurrency',async()=>{
 let concurrent=0,max=0;const batches:string[][]=[];
 const result=await resolveSelectionThumbnails(['bad',...Array.from({length:24},(_,i)=>String(i)),'1'],async ids=>{
  batches.push(ids);max=Math.max(max,++concurrent);await Promise.resolve();concurrent--;
  if(ids.includes('bad'))throw Object.assign(Error('missing'),{status:404});
  return new Map(ids.map(id=>[id,'https://images.test/'+id]));
 },new AbortController().signal);
 assert.equal(result.urls.size,24);assert.deepEqual([...result.failed],['bad']);assert.equal(max,1);assert.ok(batches.every(ids=>ids.length<=20));
});
test('thumbnail requests retry transient errors once but never retry authorization loss or aborted work',async()=>{
 let calls=0;const signal=new AbortController().signal;
 const result=await resolveSelectionThumbnails(['one'],async ids=>{if(++calls===1)throw Object.assign(Error(),{status:503});return new Map([[ids[0],'fresh']]);},signal);
 assert.equal(calls,2);assert.equal(result.urls.get('one'),'fresh');
 calls=0;await assert.rejects(resolveSelectionThumbnails(['one','two'],async()=>{calls++;throw Object.assign(Error(),{status:401});},signal));assert.equal(calls,1);
 const controller=new AbortController();controller.abort();calls=0;
 await assert.rejects(resolveSelectionThumbnails(['one'],async()=>{calls++;return new Map();},controller.signal));assert.equal(calls,0);
});
test('same card shares one row; same pattern on another fabric and a recreated card remain separate',()=>{
 const groups=groupSelectedCards([item(2),item(1),item(3,'13','F025'),{...item(4,'14'),sources:[{...item(4,'14').sources[0],retired:true}]}]);
 assert.deepEqual(groups.map(g=>[g.id,g.items.map(i=>i.id)]),[['12',['1','2']],['13',['3']],['14',['4']]]);assert.equal(groups[2].retired,true);
});
test('multiple historical sources do not duplicate a product removal checkbox',()=>{
 const row=item(1);row.sources.push({cardId:'15',cardNo:'old-card',retired:true,firstScanEventId:'2'});
 const groups=groupSelectedCards([row]);assert.equal(groups.flatMap(g=>g.items).length,1);assert.equal(groups[0].id,'12');assert.equal(groups[0].items[0].sources.length,2);
});
test('complete loading keeps a 101-colorway card together and rejects cross-session or changing pages',async()=>{
 const calls:number[]=[];const load=async(_id:string,limit:number,offset:number):Promise<SampleSessionPage>=>{calls.push(offset);return {session:{id:'11',customerReference:'客户'},total:101,selectedCardCount:1,limit,offset,items:Array.from({length:offset?1:100},(_,i)=>item(offset+i+1))};};
 const result=await loadCompleteSelection(load,'11');assert.equal(groupSelectedCards(result.items)[0].items.length,101);assert.deepEqual(calls,[0,100]);
 await assert.rejects(loadCompleteSelection(async(id,l,o)=>({...await load(id,l,o),session:{id:o?'99':'11',customerReference:'客户'}}),'11'),/变更/);
 await assert.rejects(loadCompleteSelection(async(id,l,o)=>({...await load(id,l,o),total:o?100:101}),'11'),/变更/);
});

test('current card identity takes precedence over an older still-active source',()=>{const selected=item(1);selected.sources.unshift({cardId:'2',cardNo:'G0886-F001',retired:false,firstScanEventId:'2'});Object.assign(selected.current,{currentCardId:'12',currentCardNo:'G0886-F018'});assert.equal(groupSelectedCards([selected])[0].id,'12');});

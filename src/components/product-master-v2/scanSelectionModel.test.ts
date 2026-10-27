import test from 'node:test';
import assert from 'node:assert/strict';
import {loadScanSelection} from './scanSelectionModel';
const item=(id:number)=>({id:String(id),productId:String(id),current:{productNo:'G0001-'+id+'-F018',patternNo:'G0001',colorwayNo:id,patternImageAssetId:null,fabricNo:'F018',fabricName:'丝绸',composition:'桑蚕丝',weightValue:'16',weightUnit:'mm',widthCm:'140'},sources:[{cardId:'44',cardNo:'G0001-F018',retired:true,firstScanEventId:'1'}]});
test('scan selection reads all product pages and retains unavailable card source details',async()=>{
 const calls:string[]=[];const api:typeof fetch=async(input)=>{const url=new URL(String(input),'http://fixture');calls.push(url.pathname+url.search);
  if(url.pathname.endsWith('/cards')){assert.equal(url.searchParams.get('selected'),'true');return Response.json({items:[],total:0,limit:20,offset:0});}
  const offset=Number(url.searchParams.get('offset'));return Response.json({session:{id:'11',customerReference:'客户甲',status:'open'},total:101,selectedCardCount:1,limit:100,offset,items:Array.from({length:offset===0?100:1},(_,i)=>item(offset+i+1))});
 };
 const value=await loadScanSelection(api,'11');assert.equal(value.items.length,101);assert.equal(value.cards.length,1);assert.equal(value.cards[0].products.length,101);assert.equal(value.cards[0].retired,true);assert.equal(value.cards[0].weightUnit,'mm');assert.equal(calls.length,3);
});
test('scan selection rejects a changed selection total instead of displaying a partial result',async()=>{
 const api:typeof fetch=async(input)=>{const offset=Number(new URL(String(input),'http://fixture').searchParams.get('offset'));return Response.json({session:{id:'11',customerReference:'客户甲',status:'open'},total:offset?100:101,selectedCardCount:1,limit:100,offset,items:offset?[]:Array.from({length:100},(_,i)=>item(i+1))});};
 await assert.rejects(loadScanSelection(api,'11'),/已变更/);
});

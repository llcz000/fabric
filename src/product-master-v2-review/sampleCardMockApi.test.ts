import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import jsQR from 'jsqr';
import {reviewFetch} from './mockApi';
import {composeSampleCardReviewFetch} from './sampleCardMockApi';
import {createCardQrMatrix} from '../components/product-master-v2/SampleCardLibraryV2';
import {fetchCardMasters,fetchCardFabrics,createSampleCard,fetchSampleCardPage,exportSampleCards} from '../components/product-master-v2/sampleCardModel';
const post=(api:typeof fetch,path:string,body:unknown)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const patch=(api:typeof fetch,path:string,body:unknown)=>api(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function create(api:typeof fetch,masterIndex=0,fabricIndex=0){
 const masters=await fetchCardMasters(api,''),fabrics=await fetchCardFabrics(api,'');
 return createSampleCard(api,masters.items[masterIndex],fabrics.items[fabricIndex]);
}
test('shared review API refreshes linked fabric fields while retaining card identity and blocks referenced parent rename/delete',async()=>{
 const api=composeSampleCardReviewFetch(reviewFetch);
 // This master and fabric have no product references; only the new sample card protects them.
 assert.equal((await patch(api,'/api/v2/pattern-masters/107',{isActive:true})).status,200);
 const created=await post(api,'/api/v2/sample-cards',{masterId:'107',fabricId:'422'});
 assert.equal(created.status,201);const {card}=await created.json();
 const original=(await (await api('/api/v2/fabrics/catalog?includeInactive=true&limit=100')).json()).items.find((f:{id:string})=>f.id==='422');
 try{
 assert.equal((await patch(api,'/api/v2/fabrics/422',{fabricName:'=更新后的品名',composition:'50%棉 50%麻',weightValue:16.5,weightUnit:'mm',widthValue:140.5})).status,200);
 const updated=(await fetchSampleCardPage(api,card.cardNo)).items[0];
 assert.equal(updated.description,'=更新后的品名');assert.equal(updated.composition,'50%棉 50%麻');
 assert.equal(updated.weightValue,16.5);assert.equal(updated.weightUnit,'mm');assert.equal(updated.widthValue,140.5);
 assert.equal(updated.cardNo,card.cardNo);assert.equal(updated.qrPayload,card.qrPayload);
 const duplicate=await post(api,'/api/v2/sample-cards',{masterId:'107',fabricId:'422'});
 assert.deepEqual((await duplicate.json()).card,updated);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await (await exportSampleCards(api,[card.id])).arrayBuffer()));
 const sheet=workbook.worksheets[0];assert.equal(sheet.getCell('B2').value,updated.description);assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('C2').value,updated.composition);assert.equal(sheet.getCell('D2').value,'16.5 mm');assert.equal(sheet.getCell('E2').value,'140.5 cm');assert.equal(sheet.getCell('F2').value,card.qrPayload);
 for(const [path,key,value] of [['/api/v2/pattern-masters/107','masterNo',card.masterNo],['/api/v2/fabrics/422','fabricNo',card.fabricNo]]){
  assert.equal((await patch(api,path,{[key]:value})).status,200);
  assert.equal((await patch(api,path,{[key]:'changed'})).status,409);
  assert.equal((await api(path,{method:'DELETE'})).status,409);
 }
 assert.equal((await patch(api,'/api/v2/fabrics/999999',{fabricNo:'changed'})).status,404);
 assert.equal((await api('/api/v2/fabrics/999999',{method:'DELETE'})).status,404);
 // A deactivated parent remains referenced, and the card's current specs remain readable.
 assert.equal((await patch(api,'/api/v2/fabrics/422',{isActive:false})).status,200);
 assert.equal((await fetchSampleCardPage(api,card.cardNo)).items[0].description,updated.description);
 assert.equal((await api('/api/v2/fabrics/422',{method:'DELETE'})).status,409);
 }finally{
  await patch(api,'/api/v2/fabrics/422',original);
  await patch(api,'/api/v2/pattern-masters/107',{isActive:false});
 }
});

test('sample-card-only parent references reject rename and deletion through the common review API',async()=>{
 const api=composeSampleCardReviewFetch(reviewFetch);
 await patch(api,'/api/v2/pattern-masters/107',{isActive:true});
 try{
  const response=await post(api,'/api/v2/sample-cards',{masterId:'107',fabricId:'421'});assert.equal(response.status,201);
  for(const [path,key] of [['/api/v2/pattern-masters/107','masterNo'],['/api/v2/fabrics/421','fabricNo']]){
   assert.equal((await patch(api,path,{[key]:'NEW001'})).status,409);
   assert.equal((await api(path,{method:'DELETE'})).status,409);
  }
 }finally{await patch(api,'/api/v2/pattern-masters/107',{isActive:false});}
});
test('AC-98/99 and AC-96 local review: printable fabric revision, acknowledgment, retirement, same combo new token',async()=>{
 const api=composeSampleCardReviewFetch(reviewFetch);
 const {card}=await create(api,0,0);
 const original=await (await api('/api/v2/fabrics/catalog?includeInactive=true&limit=100')).json();
 const fabric=original.items.find((f:{id:string})=>f.id===card.fabricId);
 try{
  assert.equal((await patch(api,'/api/v2/fabrics/'+card.fabricId,{fabricName:'更新印刷名称'})).status,200);
  const changed=(await fetchSampleCardPage(api,card.cardNo)).items[0];
  assert.equal(changed.needsReprint,true);assert.equal(changed.reprintRevision,'1');
  assert.equal((await fetchSampleCardPage(api,'',0,50,undefined,true)).total,1);
  const stale=await post(api,'/api/v2/sample-cards/'+card.id+'/confirm-reprinted',{expectedRevision:'0'});
  assert.equal(stale.status,409);
  const ack=await post(api,'/api/v2/sample-cards/'+card.id+'/confirm-reprinted',{expectedRevision:'1'});
  assert.equal(ack.status,200);assert.equal((await fetchSampleCardPage(api,'',0,50,undefined,true)).total,0);
  const removed=await api('/api/v2/sample-cards/'+card.id,{method:'DELETE'});assert.equal(removed.status,200);
  assert.equal((await fetchSampleCardPage(api,card.cardNo)).total,0);
  const again=await post(api,'/api/v2/sample-cards',{masterId:card.masterId,fabricId:card.fabricId});
  assert.equal(again.status,201);const replacement=(await again.json()).card;
  assert.equal(replacement.cardNo,card.cardNo);assert.notEqual(replacement.id,card.id);assert.notEqual(replacement.qrPayload,card.qrPayload);
  assert.equal((await api('/api/v2/sample-cards/'+card.id+'/confirm-reprinted',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:'1'})})).status,404);
 }finally{await patch(api,'/api/v2/fabrics/'+card.fabricId,{fabricName:fabric.fabricName});}
});
test('review composes catalog/images with stable opaque unique-combination cards, including concurrent creates',async()=>{
 const api=composeSampleCardReviewFetch(reviewFetch);
 const results=await Promise.all([create(api),create(api)]);
 assert.equal(results.filter(x=>x.created).length,1);
 assert.deepEqual(results[0].card,results[1].card);
 const {card}=results[0];
 assert.equal(card.cardNo,'G0179-F018');
 assert.match(card.qrPayload,/^[A-Za-z0-9_-]{43}$/);
 assert.ok(!card.qrPayload.includes(card.cardNo));
 const second=await create(api,0,1);assert.notEqual(card.qrPayload,second.card.qrPayload);
 const page=await fetchSampleCardPage(api,'F018');assert.deepEqual(page.items,[card]);
 const images=await post(api,'/api/image-assets/access-urls',{assetIds:['1']});assert.deepEqual(await images.json(),{results:[]});
 assert.equal((await api('/api/v2/sample-cards/scan')).status,404);
});
test('review exports selected cards in order as six literal text columns and the actual QR encodes that same raw payload',async()=>{
 const api=composeSampleCardReviewFetch(reviewFetch);
 const first=(await create(api,0,1)).card,second=(await create(api,0,0)).card;
 const blob=await exportSampleCards(api,[second.id,first.id]);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()));
 const sheet=workbook.worksheets[0];assert.equal(sheet.columnCount,6);assert.equal(sheet.rowCount,3);
 assert.deepEqual(sheet.getRow(1).values,[,'色卡编号','品名','成分','克重','门幅','二维码']);
 assert.deepEqual(sheet.getRow(2).values,[,second.cardNo,second.description,second.composition??'','','',second.qrPayload]);
 assert.equal(sheet.getCell('A3').value,first.cardNo);assert.equal(sheet.getCell('D3').value,'78.5 gsm');assert.equal(sheet.getCell('E3').value,'150 cm');
 assert.equal(sheet.getCell('F3').value,first.qrPayload);
 for(const row of [2,3])for(let col=1;col<=6;col++){assert.equal(sheet.getCell(row,col).type,ExcelJS.ValueType.String);assert.equal(sheet.getCell(row,col).numFmt,'@');}
 const matrix=createCardQrMatrix(second.qrPayload),scale=6,size=(matrix.size+8)*scale,data=new Uint8ClampedArray(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const mx=Math.floor(x/scale)-4,my=Math.floor(y/scale)-4,black=mx>=0&&my>=0&&mx<matrix.size&&my<matrix.size&&matrix.get(mx,my),i=(y*size+x)*4;
  data[i]=data[i+1]=data[i+2]=black?0:255;data[i+3]=255;
 }
 assert.equal(jsQR(data,size,size)?.data,sheet.getCell('F2').value);
});
test('review rejects unknown selections, inactive input and malformed requests without partial exports',async()=>{
 const api=composeSampleCardReviewFetch(reviewFetch),{card}=await create(api);
 assert.equal((await post(api,'/api/v2/sample-cards/export',{cardIds:[card.id,'999999']})).status,400);
 assert.equal((await post(api,'/api/v2/sample-cards/export',{cardIds:[card.id,card.id]})).status,400);
 assert.equal((await post(api,'/api/v2/sample-cards/export',{cardIds:[]})).status,400);
 assert.equal((await post(api,'/api/v2/sample-cards',{masterId:'107',fabricId:'401'})).status,409);
 assert.equal((await post(api,'/api/v2/sample-cards',{masterId:'101',fabricId:'424'})).status,409);
 assert.equal((await post(api,'/api/v2/sample-cards',{masterId:'101',fabricId:'401',qrPayload:'forged'})).status,400);
 assert.equal((await api('/api/v2/sample-cards?limit=0')).status,400);
 assert.equal((await api('/api/v2/sample-cards?query=%00')).status,400);
 assert.equal((await api('/api/v2/sample-cards',{method:'POST',body:'{'})).status,400);
});
test('admin and sales retain sample-card management; each request uses current role and other roles are denied',async()=>{
 let role:string|null='sales';const api=composeSampleCardReviewFetch(reviewFetch,()=>role);
 const {card}=await create(api);
 for(const allowed of ['sales','admin']){
  role=allowed;assert.equal((await api('/api/v2/sample-cards')).status,200);
  assert.equal((await post(api,'/api/v2/sample-cards',{masterId:'101',fabricId:'401'})).status,200);
  assert.equal((await post(api,'/api/v2/sample-cards/export',{cardIds:[card.id]})).status,200);
 }
 for(const denied of [null,'customer','viewer']){
  role=denied;const status=denied===null?401:403;
  assert.equal((await api('/api/v2/sample-cards')).status,status);
  assert.equal((await post(api,'/api/v2/sample-cards',{masterId:'101',fabricId:'401'})).status,status);
  assert.equal((await post(api,'/api/v2/sample-cards/export',{cardIds:[card.id]})).status,status);
 }
});

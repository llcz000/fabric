import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SampleCardDraftController,fetchSampleCardPage,createSampleCard,exportSampleCards,retireSampleCard,confirmSampleCardReprinted,parseSampleCardPage,toggleCardSelection,setPageSelection,fetchCardMasters,fetchCardFabrics} from './sampleCardModel';
import {SampleCardLibraryV2,SampleCardTable,SampleCardCreateDialog,NumberCandidates,SampleCardQr,createCardQrMatrix} from './SampleCardLibraryV2';
import jsQR from 'jsqr';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import {buildSampleCardsWorkbook} from '../../../server/customer-samples/cardExcel';
const master={id:'2',masterNo:'0012',isActive:true,nextColorwayNo:3,topicTags:[],versions:[{id:'4',masterId:'2',colorwayNo:1,patternNo:'0012-1',patternImageAssetId:null,remark:'',isActive:true,colorTags:[]}]};
const fabric={id:'3',fabricNo:'00018',fabricName:'丝绸',composition:'100%真丝',weightValue:16.5,weightUnit:'mm' as const,widthValue:140,remark:null,isActive:true,productCount:0};
const card={id:'1',masterId:'2',masterNo:'0012',fabricId:'3',fabricNo:'00018',cardNo:'0012-00018',description:'丝绸',composition:'100%真丝',weightValue:16.5,weightUnit:'mm' as const,widthValue:140,qrPayload:'raw_TOKEN-Case_000',isActive:true};
const json=(v:any)=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve!:(x:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};};
const page=(items:any[],offset=0,total=items.length)=>({items,total,limit:20,offset});
function controller(overrides:any={}){return new SampleCardDraftController({searchMasters:async()=>page([master]),searchFabrics:async()=>page([fabric]),loadVersions:async()=>master.versions,...overrides});}
test('B2-3 card API strictly parses complete DTO and pagination',()=>{
 assert.deepEqual(parseSampleCardPage(page([card])),page([card]));
 for(const bad of [{...card,qrPayload:null},{...card,weightValue:null},{...card,cardNo:'0012-1-00018'},{...card,id:1},{...card,widthValue:0}])assert.throws(()=>parseSampleCardPage(page([bad])));
 assert.throws(()=>parseSampleCardPage({...page([card]),total:-1}));
});
test('B2-3 create posts exactly two selected IDs and retains server stable payload on duplicate',async()=>{
 let request:any;const f=(async(_u:any,i:any)=>{request=JSON.parse(i.body);return json({card,created:false});}) as typeof fetch;
 assert.deepEqual(await createSampleCard(f,master,fabric),{card,created:false});assert.deepEqual(request,{masterId:'2',fabricId:'3'});
 await assert.rejects(()=>createSampleCard(f,null,fabric));
});
test('B2-3 fetch search page carries query and offset through authenticated injected fetch',async()=>{
 let url='';await fetchSampleCardPage((async(u:any)=>{url=String(u);return json(page([card],20,70));}) as typeof fetch,'0012',20,20);
 const q=new URL(url,'https://test.invalid');assert.equal(q.searchParams.get('query'),'0012');assert.equal(q.searchParams.get('offset'),'20');
});
test('B2-3 export never expands an empty or partial selection and preserves explicit order',async()=>{
 let body:any,calls=0;const f=(async(_u:any,i:any)=>{calls++;body=JSON.parse(i.body);return new Response('xlsx',{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});}) as typeof fetch;
 await assert.rejects(()=>exportSampleCards(f,[]));assert.equal(calls,0);
 await exportSampleCards(f,['9','1']);assert.deepEqual(body,{cardIds:['9','1']});
});
test('B2-3 candidates use actual catalog number/name query and full colorway lookup without regex',async()=>{
 const urls:string[]=[];const f=(async(u:any)=>{urls.push(String(u));return json(String(u).includes('pattern-catalog')?page([master]):page([fabric]));}) as typeof fetch;
 await fetchCardMasters(f,'0012-1',20);await fetchCardFabrics(f,'丝绸',20);
 assert.equal(new URL(urls[0],'https://t').searchParams.get('number'),'0012-1');
 assert.equal(new URL(urls[1],'https://t').searchParams.get('query'),'丝绸');
 assert.equal(new URL(urls[1],'https://t').searchParams.get('offset'),'20');
});
test('B2-3 query edits immediately clear selected identity, QC, number and generated code',async()=>{
 const d=controller();await d.edit('master','0012');await d.selectMaster(master);await d.edit('fabric','丝绸');d.selectFabric(fabric);
 assert.equal(d.cardNo,'0012-00018');d.setCreated(card);assert.equal(d.state.createdCard?.qrPayload,card.qrPayload);
 const work=d.edit('master','00');assert.equal(d.state.master,null);assert.deepEqual(d.state.versions,[]);assert.equal(d.cardNo,'');assert.equal(d.state.createdCard,null);await work;
});
test('B2-3 late candidate response cannot overwrite newer input or candidate set',async()=>{
 const old=deferred(),fresh=deferred();const d=controller({searchMasters:(q:string)=>q==='old'?old.promise:fresh.promise});
 const a=d.edit('master','old'),b=d.edit('master','new');fresh.resolve(page([{...master,masterNo:'9999'}]));await b;old.resolve(page([master]));await a;
 assert.equal(d.state.masterText,'new');assert.equal(d.state.masterPage.items[0].masterNo,'9999');
});
test('B2-3 late QC versions do not rebind after editing input',async()=>{
 const detail=deferred();const d=controller({loadVersions:()=>detail.promise});
 await d.edit('master','0012');const select=d.selectMaster(master);await d.edit('master','0099');detail.resolve(master.versions);await select;
 assert.equal(d.state.master,null);assert.deepEqual(d.state.versions,[]);
});
test('B2-3 candidate pagination keeps keyword and exposes later records',async()=>{
 const calls:any[]=[];const d=controller({searchFabrics:async(q:string,o:number)=>{calls.push([q,o]);return page(o?[{...fabric,id:'8',fabricNo:'F888'}]:[fabric],o,41);}});
 await d.edit('fabric','丝');await d.loadMore('fabric');
 assert.deepEqual(calls,[['丝',0],['丝',20]]);assert.equal(d.state.fabricPage.items.length,2);
 d.selectFabric(d.state.fabricPage.items[1]);assert.equal(d.state.fabricText,'F888');
});
test('B2-3 explicit selection across pages never expands to unseen rows',()=>{
 let ids=toggleCardSelection([],'9',true);ids=setPageSelection(ids,[card],true);assert.deepEqual(ids,['9','1']);
 ids=setPageSelection(ids,[card],false);assert.deepEqual(ids,['9']);assert.deepEqual(toggleCardSelection(ids,'9',false),[]);
});
test('AC-98/99 B2-5 pending reprint list applies server-side filter and validates revision in management calls',async()=>{
 const requests:{url:string;method:string;body:unknown}[]=[];
 const f=(async(u:any,init?:any)=>{
  requests.push({url:String(u),method:init?.method??'GET',body:init?.body?JSON.parse(init.body):null});
  return json(init?.method==='DELETE'?{id:'1',retired:true}:
   String(u).includes('/confirm-reprinted')?{id:'1',reprintRevision:'3',needsReprint:false}:page([{...card,needsReprint:true,reprintRevision:'3'}]));
 }) as typeof fetch;
 const found=await fetchSampleCardPage(f,'0012',0,50,undefined,true);
 assert.equal(found.items[0].needsReprint,true);
 assert.equal(new URL(requests[0].url,'https://q.invalid').searchParams.get('needsReprint'),'true');
 const confirmed=await confirmSampleCardReprinted(f,{...card,needsReprint:true,reprintRevision:'3'});
 assert.deepEqual(confirmed,{id:'1',reprintRevision:'3',needsReprint:false});
 assert.deepEqual(requests[1],{url:'/api/v2/sample-cards/1/confirm-reprinted',method:'POST',body:{expectedRevision:'3'}});
 assert.deepEqual(await retireSampleCard(f,'1'),{id:'1',retired:true});
 assert.deepEqual(requests[2],{url:'/api/v2/sample-cards/1',method:'DELETE',body:null});
});
test('AC-98/99 B2-5 printing and retirement actions appear per card without modifying six Excel business columns',()=>{
 const annotated={...card,needsReprint:true,reprintRevision:'4'};
 const html=renderToStaticMarkup(React.createElement(SampleCardTable,{page:page([annotated]),selectedIds:[],
  onToggle:()=>{},onPageAll:()=>{},onPage:()=>{},onConfirmReprinted:()=>{},onRetire:()=>{}}));
 assert.match(html,/需重新打印/);assert.match(html,/标记已重新打印/);assert.match(html,/删除色卡/);
 for(const title of ['色卡编号','品名','成分','克重','门幅','二维码'])assert(html.includes(title));
 assert.equal((html.match(/<th /g)||[]).length,8,'checkbox plus six business headers and final operations column');
 const row=html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]??'';
 const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
 assert.match(cells.at(-1)??'',/删除色卡/,'delete action belongs to the rightmost cell');
 assert(!cells[1].includes('删除色卡'),'card number cell has no delete action');
});
test('B2-3 dropdown option labels contain ONLY master number or fabric number',()=>{
 const m=renderToStaticMarkup(React.createElement(NumberCandidates,{kind:'master',items:[master],onSelect:()=>{}}));
 const f=renderToStaticMarkup(React.createElement(NumberCandidates,{kind:'fabric',items:[fabric],onSelect:()=>{}}));
 assert.match(m,/>0012</);assert(!m.includes('0012-1'));assert(!m.includes('<img'));assert.match(f,/>00018</);assert(!f.includes('丝绸'));assert(!f.includes('100%'));
});
test('B2-3 selected QC contains full colorway IDs and read-only specs, modal has only two inputs',async()=>{
 const d=controller();await d.selectMaster(master);d.selectFabric(fabric);
 const html=renderToStaticMarkup(React.createElement(SampleCardCreateDialog,{controller:d,onClose:()=>{},onCreate:async()=>{},imageUrls:new Map()}));
 assert.equal((html.match(/<input/g)||[]).length,2);assert.match(html,/0012-1/);assert.match(html,/缺少图片/);assert.match(html,/100%真丝/);assert.match(html,/16.5 mm/);assert.match(html,/140 cm/);assert.match(html,/0012-00018/);
});
test('B2-3 actual default QR matrix decodes to exact server payload and is rendered as SVG',()=>{
 const matrix=createCardQrMatrix(card.qrPayload),scale=7,margin=4,size=(matrix.size+margin*2)*scale;
 const pixels=new Uint8ClampedArray(size*size*4);pixels.fill(255);
 for(let y=0;y<matrix.size;y++)for(let x=0;x<matrix.size;x++)if(matrix.get(x,y))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const p=(((y+margin)*scale+dy)*size+(x+margin)*scale+dx)*4;pixels[p]=pixels[p+1]=pixels[p+2]=0;}
 assert.equal(jsQR(pixels,size,size)?.data,card.qrPayload);
 const html=renderToStaticMarkup(React.createElement(SampleCardQr,{payload:card.qrPayload}));assert.match(html,/<svg/);assert.match(html,/<path/);
});
test('B2-3 six business table columns and stable QR use current row, page-all is explicit',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleCardTable,{page:page([card],20,70),selectedIds:['1'],onToggle:()=>{},onPageAll:()=>{},onPage:()=>{}}));
 for(const h of ['色卡编号','品名','成分','克重','门幅','二维码'])assert(html.includes(h));
 assert.match(html,/raw_TOKEN-Case_000/);assert.match(html,/本页/);assert.match(html,/70/);assert.match(html,/下一页/);
});
test('B2-3 independent management page omits cancelled label/import/configuration flows',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleCardLibraryV2,{apiFetch:fetch}));
 assert.match(html,/实体色卡/);assert.match(html,/新增色卡/);assert.match(html,/导出 Excel/);
 for(const s of ['下载标签','标签预览','PNG','SVG标签','导入色卡','标签尺寸'])assert(!html.includes(s));
});
test('B2-3 actual rendered QR SVG decodes exactly to real XLSX QRcode text for three distinct cards',async()=>{
 const cards=[card,{...card,id:'8',masterNo:'0005',fabricNo:'F009',cardNo:'0005-F009',qrPayload:'CaseSensitive_0000000000000-different_payload'}, {...card,id:'9',fabricNo:'00022',cardNo:'0012-00022',composition:null,weightValue:null,weightUnit:null,widthValue:null,qrPayload:'012345678901234567890123456789'}];
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await buildSampleCardsWorkbook(cards) as any);
 for(let i=0;i<cards.length;i++){
  const svg=renderToStaticMarkup(React.createElement(SampleCardQr,{payload:cards[i].qrPayload,size:350}));
  const {data,info}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const decoded=jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data;
  assert.equal(decoded,cards[i].qrPayload);assert.equal(decoded,workbook.worksheets[0].getCell(i+2,6).value);
  assert.equal(workbook.worksheets[0].getCell(i+2,1).value,cards[i].cardNo);
 }
});
test('B2-3 cancelled draft ignores all pending requests and a new dialog starts without saved state',async()=>{
 const result=deferred(),d=controller({searchFabrics:()=>result.promise});
 const pending=d.edit('fabric','丝');d.dispose();result.resolve(page([fabric]));await pending;
 assert.equal(d.state.fabricPage.items.length,0);
 const reopened=controller();assert.equal(reopened.cardNo,'');assert.equal(reopened.state.master,null);assert.equal(reopened.state.fabric,null);assert.equal(reopened.state.createdCard,null);
});
test('B2-3 no selection or inactive records cannot create card and foreign server QR cannot bind',async()=>{
 const d=controller();d.selectFabric({...fabric,isActive:false});await d.selectMaster({...master,isActive:false});
 assert.equal(d.cardNo,'');assert.equal(d.state.fabric,null);assert.equal(d.state.master,null);
 await d.selectMaster(master);d.selectFabric(fabric);assert.throws(()=>d.setCreated({...card,fabricId:'88'}));
 await assert.rejects(()=>fetchSampleCardPage(fetch,'x'.repeat(101)));
 await assert.rejects(()=>fetchSampleCardPage(fetch,'',1000001));
});

test('card list retains compact QR and exposes an accessible enlargement action for scanning one card',()=>{const html=renderToStaticMarkup(React.createElement(SampleCardTable,{page:page([card]),selectedIds:[],onToggle(){},onPageAll(){},onPage(){}}));assert(html.includes('aria-label="放大色卡二维码 '+card.cardNo+'"'));assert(html.includes('width="52"'));});

test('card row offers view patterns in operations',()=>{const html=renderToStaticMarkup(React.createElement(SampleCardTable,{page:page([card]),selectedIds:[],onToggle(){},onPageAll(){},onPage(){},onViewPatterns(){}} as any));assert.match(html,/查看花型/);});

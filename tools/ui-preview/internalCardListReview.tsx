import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import {SampleCardLibraryV2} from '../../src/components/product-master-v2/SampleCardLibraryV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
const card={id:'1',masterId:'2',masterNo:'G0886',fabricId:'3',fabricNo:'F018',cardNo:'G0886-F018',
 description:'轻薄雪纺',composition:'聚酯纤维 100%',weightValue:80,weightUnit:'gsm',widthValue:145,
 colorways:Array.from({length:6},(_,i)=>({productId:String(100+i),colorwayNo:i+1,patternImageAssetId:'dddddddd-4444-4444-8444-'+String(100+i).padStart(12,'0')})),
 qrPayload:'SAMPLE_FIXTURE_CODE_ONLY',isActive:true,needsReprint:false,reprintRevision:'1'};
const demoRows=[card,{...card,id:'4',masterId:'5',masterNo:'G0379',cardNo:'G0379-F018',description:'轻薄印花仿丝雪纺',composition:'聚酯纤维 95% / 氨纶 5%'},{...card,id:'6',masterId:'7',masterNo:'G0626',cardNo:'G0626-F018',description:'丝绒印花',composition:'100%涤纶'}];
const sortingRows=[8,15,100,...Array.from({length:35},(_,i)=>i+1).filter(n=>n!==8&&n!==15)].flatMap((number,index)=>['F999','F001'].map((fabricNo,fabricIndex)=>{
 const masterNo='G'+number;return {...card,id:String(index*2+fabricIndex+1),masterId:String(number),masterNo,
  fabricId:String(fabricIndex+1),fabricNo,cardNo:masterNo+'-'+fabricNo,colorways:[]};
}));
const fakeFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input),window.location.href);
 if(url.pathname.endsWith('/access-urls'))return Response.json({results:JSON.parse(String(init?.body)).requests.map((r:{assetId:string;variant:string})=>({...r,url:'https://fabric-card-fixture.invalid/'+r.assetId+'.svg'}))});
 if(init?.method==='DELETE')return Response.json({error:'Card has products',productCount:3},{status:409});
 if(url.pathname.endsWith('/api/v2/products'))return new Response(JSON.stringify({items:[],total:0,limit:20,offset:0}),{status:200,headers:{'Content-Type':'application/json'}});
 if(url.pathname.endsWith('/share'))return new Response(JSON.stringify({url:new URL('/c/'+'a'.repeat(43),window.location.origin).href}),{status:200,headers:{'Content-Type':'application/json'}});
 if(!url.pathname.endsWith('/api/v2/sample-cards'))return new Response('Not found',{status:404});
 const query=(url.searchParams.get('query')||'').toLowerCase();
 const matched=(location.search.includes('sorting=1')?sortingRows:demoRows).filter(c=>[c.cardNo,c.masterNo,c.fabricNo,c.description].some(x=>x.toLowerCase().includes(query)));
 const sort=url.searchParams.get('sort');
 if(sort==='numberAsc'||sort==='numberDesc'){
  const direction=sort==='numberAsc'?1:-1;
  matched.sort((a,b)=>direction*(Number(a.masterNo.slice(1))-Number(b.masterNo.slice(1))||Number(a.id)-Number(b.id)));
 }else if(location.search.includes('sorting=1'))matched.sort((a,b)=>Number(b.id)-Number(a.id));
 const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??50);
 return new Response(JSON.stringify({items:matched.slice(offset,offset+limit),total:matched.length,limit,offset}),
  {status:200,headers:{'Content-Type':'application/json'}});
}) as typeof fetch;
const thumbnails=async(ids:string[])=>new Map(ids.map((id,index)=>[id,'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${['#ede5df','#d9e7ec','#e9dce8','#e3e8d8'][index%4]}"/><path d="M0 100Q70 30 120 40" fill="none" stroke="#607369" stroke-width="2"/><circle cx="55" cy="45" r="20" fill="#ae7286"/></svg>`)]));
createRoot(document.getElementById('root')!).render(<React.StrictMode>
 <div className="v2-shell"><ConfirmProvider><SampleCardLibraryV2 apiFetch={fakeFetch} resolveThumbnails={thumbnails} shareEnabled/></ConfirmProvider></div>
 </React.StrictMode>);

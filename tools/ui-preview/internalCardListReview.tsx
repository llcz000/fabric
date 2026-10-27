import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import {SampleCardLibraryV2} from '../../src/components/product-master-v2/SampleCardLibraryV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
const card={id:'1',masterId:'2',masterNo:'G0886',fabricId:'3',fabricNo:'F018',cardNo:'G0886-F018',
 description:'轻薄雪纺',composition:'聚酯纤维 100%',weightValue:80,weightUnit:'gsm',widthValue:145,
 qrPayload:'SAMPLE_FIXTURE_CODE_ONLY',isActive:true,needsReprint:false,reprintRevision:'1'};
const demoRows=[card,{...card,id:'4',masterId:'5',masterNo:'G0379',cardNo:'G0379-F018',description:'轻薄印花仿丝雪纺',composition:'聚酯纤维 95% / 氨纶 5%'},{...card,id:'6',masterId:'7',masterNo:'G0626',cardNo:'G0626-F018',description:'丝绒印花',composition:'100%涤纶'}];
const fakeFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input),window.location.href);
 if(init?.method==='DELETE')return Response.json({error:'Card has products',productCount:3},{status:409});
 if(url.pathname.endsWith('/api/v2/products'))return new Response(JSON.stringify({items:[],total:0,limit:20,offset:0}),{status:200,headers:{'Content-Type':'application/json'}});
 if(url.pathname.endsWith('/share'))return new Response(JSON.stringify({url:new URL('/c/'+'a'.repeat(43),window.location.origin).href}),{status:200,headers:{'Content-Type':'application/json'}});
 if(!url.pathname.endsWith('/api/v2/sample-cards'))return new Response('Not found',{status:404});
 const query=(url.searchParams.get('query')||'').toLowerCase();
 const matched=demoRows.filter(c=>[c.cardNo,c.masterNo,c.fabricNo,c.description].some(x=>x.toLowerCase().includes(query)));
 return new Response(JSON.stringify({items:matched,total:matched.length,limit:Number(url.searchParams.get('limit')),offset:Number(url.searchParams.get('offset'))}),
  {status:200,headers:{'Content-Type':'application/json'}});
}) as typeof fetch;
createRoot(document.getElementById('root')!).render(<React.StrictMode>
 <div className="v2-shell"><ConfirmProvider><SampleCardLibraryV2 apiFetch={fakeFetch} shareEnabled/></ConfirmProvider></div>
 </React.StrictMode>);

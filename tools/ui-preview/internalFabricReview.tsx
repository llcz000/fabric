import {relatedProductsPreview} from './fixtures/relatedProducts';
import {FabricProductsDialog} from '../../src/components/product-master-v2/FabricProductsDialog';
import {ProductCatalogV2} from '../../src/components/product-master-v2/ProductCatalogV2';
import {FabricImportV2} from '../../src/components/product-master-v2/FabricImportV2';
import importPreview from './fixtures/fabricImportReview.json';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/product-master-v2/v2Experience.css';
import FabricLibraryV2 from '../../src/components/product-master-v2/FabricLibraryV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
import type {FabricCatalogItem} from '../../src/components/product-master-v2/fabricModel';

const samples:FabricCatalogItem[]=[
{id:'1',fabricNo:'F018',fabricName:'轻薄印花雪纺',composition:'聚酯纤维 100%',weightValue:80,weightUnit:'gsm',widthValue:145,remark:'适合裙装、衬衫',isActive:true,productCount:5},
{id:'2',fabricNo:'F032',fabricName:'高密棉麻',composition:'棉 65% / 亚麻 35%',weightValue:16.5,weightUnit:'mm',widthValue:148,remark:null,isActive:true,productCount:2},
{id:'3',fabricNo:'F036',fabricName:'柔软仿真丝斜纹绸',composition:'涤纶 92% / 氨纶 8%',weightValue:null,weightUnit:null,widthValue:150,remark:'旧面料待清理',isActive:true,productCount:0}
];
const apiFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input),location.href);
 if(url.pathname==='/api/v2/products'){
  if(location.search.includes('products=1')&&!url.searchParams.has('fabricId'))url.searchParams.set('fabricId','1');
  return relatedProductsPreview(url,init);
 }
 if(url.pathname==='/api/v2/tags')return Response.json({items:[]});
 if(url.pathname.endsWith('/fabrics/import/preview')){
  const payload=JSON.parse(String(init?.body));
  if(Object.keys(payload.options).some(k=>!['filename','defaultWeightUnit'].includes(k)))throw Error('Unexpected column configuration');
  return Response.json(importPreview);
 }
 if(!url.pathname.endsWith('/api/v2/fabrics/catalog'))return new Response('Local demo only',{status:404});
 const query=(url.searchParams.get('query')||'').toLowerCase();
 const no=(url.searchParams.get('fabricNo')||'').toLowerCase();
 const name=(url.searchParams.get('fabricName')||'').toLowerCase();
 const comp=(url.searchParams.get('composition')||'').toLowerCase();
 const inactive=url.searchParams.get('includeInactive')==='true';
 const matches=samples.filter(x=>(inactive||x.isActive)&&(!query||[x.fabricNo,x.fabricName,x.composition??''].some(v=>v.toLowerCase().includes(query)))&&x.fabricNo.toLowerCase().includes(no)&&x.fabricName.toLowerCase().includes(name)&&(x.composition??'').toLowerCase().includes(comp));
 return new Response(JSON.stringify({items:matches,total:matches.length,limit:50,offset:0}),{status:200,headers:{'content-type':'application/json'}});
}) as typeof fetch;

function Screen(){
 const [message,setMessage]=useState('');
 const [linked,setLinked]=useState<FabricCatalogItem|null>(null);
 return <div className="v2-shell"><ConfirmProvider>
  {location.search.includes('products=1')?<ProductCatalogV2 apiFetch={apiFetch} canManage allowExport={false} onEdit={item=>setMessage('编辑 '+item.productNo)}/>:location.search.includes('import=1')?<FabricImportV2 apiFetch={apiFetch} canManage onCancel={()=>{location.href='/tools/ui-preview/entries/ui-ux-internal-fabrics.html';}}/>:<FabricLibraryV2 apiFetch={apiFetch} canManage allowExport onImport={()=>setMessage('本机演示：不会读取 Excel')}
   onViewProducts={setLinked}/>}
  {linked?<FabricProductsDialog key={linked.id} apiFetch={apiFetch} fabric={linked} onClose={()=>setLinked(null)}/>:null}
  {message?<p role="status" className="mx-5 text-sm text-slate-500">{message}</p>:null}
 </ConfirmProvider></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Screen/></React.StrictMode>);

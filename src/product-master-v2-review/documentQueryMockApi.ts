import type {CompanyProfile} from '../types';
import type {DocumentRecord,DocumentLine} from '../../server/order-v2/documents';
import {buildDocumentPrintModel} from '../lib/documentPrintModel';
export const documentReviewCompany={name:'Fabric 演示公司',address:'演示地址',phone:'演示电话',defaultTerms:'仅本机评审数据',depositTerms:'定金合同评审数据'} as CompanyProfile;
const line=(id:number,productNo:string,colorNo:string,productName:string,meters:number,type:string):DocumentLine=>({
 id:String(id),productId:null,source:null,snapshot:null,productNo,colorNo,productName,composition:'棉 / 涤',
 weight:120,widthCm:150,meters,unitPrice:20,amount:meters*20,remark:'演示明细',pieceMeters:type==='bulk'?[meters/2,meters/2]:null,deductionMeters:0
});
function record(id:number,ownerId='7'):DocumentRecord{
 const type=(['sample','bulk','deposit'] as const)[id%3],items=[line(id*10+1,'P001','1','棉麻布',10,type),line(id*10+2,'P002','2','轻薄雪纺',20,type)];
 return {id:String(id),ownerId,orderNo:({sample:'YB',bulk:'XS',deposit:'DJ'}[type])+'-DEMO-'+String(id).padStart(3,'0'),
  date:'2026-10-'+String(id%16+1).padStart(2,'0'),receivingUnit:ownerId==='7'?'演示客户甲':'演示客户乙',type,deposit:type==='deposit'?25:0,
  styleNo:'',issuer:'演示开单人',receiver:'',receiverPhone:'',receiverAddress:'',settled:type!=='deposit'&&id%2===0,displaySnapshot:null,
  totalMeters:30,totalPieces:type==='sample'?2:type==='bulk'?4:0,totalAmount:600,deductionMeters:0,items};
}
/** Memory-only fixture, no native fetch fallbacks or application persistence. */
export function createDocumentQueryReviewApi(role:'admin'|'sales'){
 const documents=[...Array.from({length:28},(_,i)=>record(i+1)),record(900,'9')];let fail=false;
 const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 const apiFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,'http://fabric-review.invalid');
  const method=init?.method??'GET';
  if(method!=='GET')return response({error:'查询评审不模拟保存或文件导出'},405);
  if(!url.pathname.startsWith('/api/v2/documents'))return response({error:'Not found'},404);
  if(fail){fail=false;return response({error:'模拟一次查询失败'},503);}
  const params=url.searchParams;
  const visible=documents.filter(doc=>role==='admin'||doc.ownerId==='7');
  if(url.pathname==='/api/v2/documents/stats'){
   if([...params.keys()].some(key=>!['from','to'].includes(key)))return response({error:'Invalid statistics filters'},400);
   const from=params.get('from')??'',to=params.get('to')??'';
   if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))return response({error:'Invalid date range'},400);
   const scoped=visible.filter(doc=>(!from||doc.date>=from)&&(!to||doc.date<=to));
   const group=(type:'sample'|'bulk'|'deposit')=>{
    const rows=scoped.filter(doc=>doc.type===type);
    const result={count:rows.length,meters:rows.reduce((sum,doc)=>sum+doc.totalMeters,0)};
    return type==='deposit'?{...result,contractAmount:rows.reduce((sum,doc)=>sum+doc.totalAmount,0)}
     :{...result,amount:rows.reduce((sum,doc)=>sum+doc.totalAmount,0)};
   };
   const ranked=new Map<string,number>();
   for(const doc of scoped)for(const item of doc.items){
    const name=item.productName.trim()||'未命名的面料';
    ranked.set(name,(ranked.get(name)??0)+item.meters);
   }
   const topProducts=[...ranked].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5)
    .map(([productName,meters])=>({productName,meters}));
   const recentOrders=[...scoped].sort((a,b)=>b.date.localeCompare(a.date)||Number(b.id)-Number(a.id)).slice(0,4)
    .map(doc=>({id:doc.id,orderNo:doc.orderNo,date:doc.date,receivingUnit:doc.receivingUnit,type:doc.type,totalMeters:doc.totalMeters,totalAmount:doc.totalAmount}));
   return response({orderCount:scoped.length,metersTotal:scoped.filter(doc=>doc.type!=='deposit').reduce((sum,doc)=>sum+doc.totalMeters,0),
    amountTotal:scoped.filter(doc=>doc.type!=='deposit').reduce((sum,doc)=>sum+doc.totalAmount,0),
    byType:{sample:group('sample'),bulk:group('bulk'),deposit:group('deposit')},topProducts,recentOrders});
  }

  if([...params.keys()].some(key=>!['customer','productNo','colorNo','productName','type','from','to','settled','limit','offset'].includes(key)))return response({error:'Invalid filters'},400);
  const limit=Number(params.get('limit')??20),offset=Number(params.get('offset')??0);
  if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0)return response({error:'Invalid page'},400);
  const matchLine=(row:DocumentLine)=>['productNo','colorNo','productName'].every(key=>!params.get(key)||String(row[key as keyof DocumentLine]).includes(params.get(key)!));
  const matches=visible.filter(doc=>(!params.get('customer')||doc.receivingUnit.includes(params.get('customer')!))&&
   (!params.get('type')||doc.type===params.get('type'))&&(!params.get('from')||doc.date>=params.get('from')!)&&(!params.get('to')||doc.date<=params.get('to')!)&&
   (!params.has('settled')||doc.type!=='deposit'&&String(doc.settled)===params.get('settled'))&&doc.items.some(matchLine))
   .sort((a,b)=>b.date.localeCompare(a.date)||Number(b.id)-Number(a.id));
  const pieces=(doc:DocumentRecord,row:DocumentLine)=>doc.type==='sample'?1:doc.type==='bulk'?row.pieceMeters?.length??0:0;
  if(url.pathname==='/api/v2/documents')return response({total:matches.length,limit,offset,items:matches.slice(offset,offset+limit).map(({items,...doc})=>doc)});
  if(url.pathname==='/api/v2/documents/matching-totals'){
   const rows=matches.filter(doc=>doc.type!=='deposit').flatMap(doc=>doc.items.filter(matchLine).map(item=>({...item,pieces:pieces(doc,item)})));
   return response({matchingLineCount:rows.length,metersTotal:rows.reduce((n,r)=>n+r.meters,0),amountTotal:rows.reduce((n,r)=>n+r.amount,0),piecesTotal:rows.reduce((n,r)=>n+r.pieces,0)});
  }
  const path=/^\/api\/v2\/documents\/([1-9]\d*)(?:\/(matching-items|print-model))?$/.exec(url.pathname);
  if(!path)return response({error:'Not found'},404);
  const doc=(path[2]==='matching-items'?matches:visible).find(doc=>doc.id===path[1]);
  if(!doc)return response({error:'Order not found'},404);
  if(path[2]==='matching-items'){
   const items=doc.items.filter(matchLine).map(item=>({id:item.id,productNo:item.productNo,colorNo:item.colorNo,productName:item.productName,meters:item.meters,amount:item.amount,pieces:pieces(doc,item)}));
   return response({orderId:doc.id,total:items.length,limit,offset,items:items.slice(offset,offset+limit)});
  }
  if(path[2]==='print-model')return response(buildDocumentPrintModel({
   type:doc.type==='bulk'?'sales':doc.type,docNo:doc.orderNo,date:doc.date,customerName:doc.receivingUnit,
   companyName:documentReviewCompany.name,companyAddress:documentReviewCompany.address,companyPhone:documentReviewCompany.phone,
   defaultTerms:documentReviewCompany.defaultTerms,depositTerms:documentReviewCompany.depositTerms??'',terms:documentReviewCompany.defaultTerms,
   issuer:doc.issuer,receiver:'',receiverPhone:'',receiverAddress:'',totalMeters:doc.totalMeters,totalPieces:doc.totalPieces,totalAmount:doc.totalAmount,
   receivableAmount:doc.totalAmount,deposit:doc.deposit,deductionMeters:0,salesRollFallback:false,
   items:doc.items.map(item=>({itemNo:item.productNo,colorNo:item.colorNo,productName:item.productName,meters:item.meters,unitPrice:item.unitPrice,
    amount:item.amount,composition:item.composition,weight:'120 gsm',width:'150',rollValues:item.pieceMeters??[],remark:item.remark}))
  }));
  return response(structuredClone(doc));
 }) as typeof fetch;
 return {apiFetch,failNext(){fail=true;}};
}

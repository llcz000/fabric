import React from 'react';
import {V2DocumentBrowser} from '../../src/components/document-product-selector/V2DocumentBrowser';
import {V2DocumentStats} from '../../src/components/document-product-selector/V2DocumentStats';
import type {DocumentStatsData} from '../../src/components/document-product-selector/documentStatsModel';
import type {CompanyProfile} from '../../src/types';
import type {DocumentPrintModel} from '../../src/lib/documentPrintModel';

const qa={deleted:false,deletes:0,fail:false};
(window as any).documentQa=qa;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const documentType=new URLSearchParams(location.search).get('type');
const type=documentType==='sample'?'sample':documentType==='deposit'?'deposit':'bulk';
const stats:DocumentStatsData={
 orderCount:3,metersTotal:35,amountTotal:350,pendingAmount:250,pendingCount:2,
 byType:{sample:{count:1,meters:10,amount:100},bulk:{count:1,meters:20,amount:250},deposit:{count:1,meters:5,contractAmount:700}},
 topProducts:[{productName:'棉麻布',meters:30}],
 recentOrders:[{id:'47',orderNo:'XS20261029-047',date:'2026-10-29',receivingUnit:'测试客户',type,totalMeters:10,totalAmount:200}],compare:null
};
const printModel:DocumentPrintModel={
 type:type==='bulk'?'sales':type,title:{sample:'样布码单',bulk:'销售发货码单',deposit:'定金单'}[type],companyName:'示例面料公司',companyLines:['示例地址','示例电话'],
 docNo:'XS20261029-047',dateText:'2026-10-29',customerName:'测试客户',
 columns:[{key:'itemNo',label:'货号',webFraction:1,excelWidth:11}],rows:[['G0001-1-F001']],
 summaries:[{left:'合计：10.00 米'}],terms:'',signature:{issuer:'',receiver:'',phone:'',receiverAddress:''}
};
const apiFetch=(async(input,init)=>{
 const url=String(input);
 if(init?.method==='DELETE'){
  qa.deletes++;
  if(JSON.stringify(JSON.parse(String(init.body)))!==JSON.stringify({confirm:true}))return json({},400);
  if(qa.fail)return json({},503);
  qa.deleted=true;return json({deleted:true});
 }
 if(url==='/api/v2/documents/47/print-model?preview=1')return json(printModel);
 if(url.startsWith('/api/v2/documents/stats'))return json(stats);
 if(url.includes('matching-totals'))return json({matchingLineCount:qa.deleted?0:1,metersTotal:10,piecesTotal:1,amountTotal:200});
 return json({total:qa.deleted?0:1,limit:20,offset:0,items:qa.deleted?[]:[{id:'47',orderNo:'XS20261029-047',date:'2026-10-29',receivingUnit:'测试客户',type,totalMeters:10,totalPieces:1,totalAmount:200,settled:false}]});
}) as typeof fetch;
export function DocumentStatsReview(){return <V2DocumentStats apiFetch={apiFetch} onProduct={()=>{}} onDocument={()=>{}}/>;}
export function DocumentBrowserReview(){return <V2DocumentBrowser apiFetch={apiFetch} role="admin" companyProfile={{} as CompanyProfile}/>;}

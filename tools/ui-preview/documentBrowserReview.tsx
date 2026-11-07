import React from 'react';
import {V2DocumentBrowser} from '../../src/components/document-product-selector/V2DocumentBrowser';
import type {CompanyProfile} from '../../src/types';

const qa={deleted:false,deletes:0,fail:false};
(window as any).documentQa=qa;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const apiFetch=(async(input,init)=>{
 const url=String(input);
 if(init?.method==='DELETE'){
  qa.deletes++;
  if(JSON.stringify(JSON.parse(String(init.body)))!==JSON.stringify({confirm:true}))return json({},400);
  if(qa.fail)return json({},503);
  qa.deleted=true;return json({deleted:true});
 }
 if(url.includes('matching-totals'))return json({matchingLineCount:qa.deleted?0:1,metersTotal:10,piecesTotal:1,amountTotal:200});
 return json({total:qa.deleted?0:1,limit:20,offset:0,items:qa.deleted?[]:[{id:'47',orderNo:'XS20261029-047',date:'2026-10-29',receivingUnit:'测试客户',type:'bulk',totalMeters:10,totalPieces:1,totalAmount:200,settled:false}]});
}) as typeof fetch;
export function DocumentBrowserReview(){return <V2DocumentBrowser apiFetch={apiFetch} role="admin" companyProfile={{} as CompanyProfile}/>;}

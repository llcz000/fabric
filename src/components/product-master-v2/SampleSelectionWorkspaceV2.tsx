import {useSampleCardExport} from './useSampleCardExport';
import React,{useEffect,useMemo,useRef} from 'react';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
import {SampleSelectionPanel} from './SampleSelectionPanel';
import {createSampleSelectionClient,createV2SelectionFetch,selectionAccessRevoked} from './sampleSelectionClient';
import {searchManualCards} from './manualSelectionModel';
import {resolveImageUrls} from './catalogModel';
import type {CatalogImageResolver} from './ProductImageTabs';

/** B3 integration shell; caller passes the same V2 authenticated fetch used for catalog APIs.
 * This is not mounted on the legacy App or a public route.
 */
export interface SampleSelectionWorkspaceV2Props{
 sessionId:string;
 apiFetch:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
 /** Supply only when apiFetch is a plain transport; the integration owner supplies an existing V2 login session. */
 getV2SessionToken?:()=>string|null;
 onRescan?:()=>Promise<void>|void;
 initialPage?:SampleSessionPage;
 resolveImages?:CatalogImageResolver;
 onAccessRevoked?:()=>void;
 readOnly?:boolean;
}
export function SampleSelectionWorkspaceV2({sessionId,apiFetch,getV2SessionToken,onRescan,initialPage,resolveImages,onAccessRevoked,readOnly=false}:SampleSelectionWorkspaceV2Props){
 const exportScope=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();exportScope.current=controller;return()=>controller.abort();},[sessionId,apiFetch]);
 const privateFetch=useMemo(()=>getV2SessionToken?createV2SelectionFetch(apiFetch,getV2SessionToken):apiFetch,[apiFetch,getV2SessionToken]);
 const exporter=useSampleCardExport(privateFetch);
 const api=useMemo(()=>{
  const guarded:typeof fetch=async(input,init)=>{const response=await privateFetch(input,init);if(selectionAccessRevoked({status:response.status}))onAccessRevoked?.();return response;};
  return createSampleSelectionClient(guarded);
 },[privateFetch,onAccessRevoked]);
 const search=useMemo(()=>(filters:Parameters<typeof searchManualCards>[1],signal?:AbortSignal)=>searchManualCards(privateFetch,filters,signal),[privateFetch]);
 // Keep the established image access adapter separate from the V2-only selection transport.
 const thumbnails=useMemo(()=>(ids:string[],signal?:AbortSignal)=>resolveImages?resolveImages(ids,'thumbnail',signal):resolveImageUrls(apiFetch,ids,'thumbnail',signal),[apiFetch,resolveImages]);
 const exportCards=async(selectedSession:SampleSessionPage['session'],onUpdated:()=>Promise<void>)=>{
  const controller=exportScope.current;if(!controller||controller.signal.aborted)return false;
  try{
   const result=await exporter.download(selectedSession,controller.signal,{onUpdated});
   if(!result||controller.signal.aborted)return false;
   const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=result.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);return true;
  }catch(error){if(!controller.signal.aborted&&selectionAccessRevoked(error))onAccessRevoked?.();throw error;}
 };
 return <><SampleSelectionPanel key={sessionId} sessionId={sessionId}
  load={api.load} onExport={exportCards} remove={api.remove} removeItems={api.removeItems} readOnly={readOnly} addManual={api.addManual} searchManual={search} resolveThumbnails={thumbnails} onRescan={onRescan} initialPage={initialPage}/>{exporter.dialog}</>;
}
export default SampleSelectionWorkspaceV2;

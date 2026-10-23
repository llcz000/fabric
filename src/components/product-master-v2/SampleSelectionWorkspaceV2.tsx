import React,{useMemo} from 'react';
import type {SampleSessionPage} from '../../../server/customer-samples/sessionRead';
import {SampleSelectionPanel} from './SampleSelectionPanel';
import {createSampleSelectionClient,createV2SelectionFetch} from './sampleSelectionClient';
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
}
export function SampleSelectionWorkspaceV2({sessionId,apiFetch,getV2SessionToken,onRescan,initialPage,resolveImages}:SampleSelectionWorkspaceV2Props){
 const privateFetch=useMemo(()=>getV2SessionToken?createV2SelectionFetch(apiFetch,getV2SessionToken):apiFetch,[apiFetch,getV2SessionToken]);
 const api=useMemo(()=>createSampleSelectionClient(privateFetch),[privateFetch]);
 const search=useMemo(()=>(filters:Parameters<typeof searchManualCards>[1],signal?:AbortSignal)=>searchManualCards(privateFetch,filters,signal),[privateFetch]);
 // Keep the established image access adapter separate from the V2-only selection transport.
 const thumbnails=useMemo(()=>(ids:string[],signal?:AbortSignal)=>resolveImages?resolveImages(ids,'thumbnail',signal):resolveImageUrls(apiFetch,ids,'thumbnail',signal),[apiFetch,resolveImages]);
 return <SampleSelectionPanel key={sessionId} sessionId={sessionId}
  load={api.load} remove={api.remove} addManual={api.addManual} searchManual={search} resolveThumbnails={thumbnails} onRescan={onRescan} initialPage={initialPage}/>;
}
export default SampleSelectionWorkspaceV2;

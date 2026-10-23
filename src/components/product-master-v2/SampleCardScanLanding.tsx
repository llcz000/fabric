import React,{useEffect,useState} from 'react';
import {resolveScannedSampleCard,type SampleCard} from './sampleCardModel';
import {SampleCardPatternsDialog} from './SampleCardPatternsDialog';
export function SampleCardScanLanding({cardToken,apiFetch}:{cardToken:string;apiFetch:typeof fetch}){
 const [card,setCard]=useState<SampleCard|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[viewing,setViewing]=useState(false);
 useEffect(()=>{const controller=new AbortController();setCard(null);setError('');
  void resolveScannedSampleCard(apiFetch,cardToken,controller.signal).then(result=>{if(!controller.signal.aborted)setCard(result);})
   .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'色卡读取失败');});
  return()=>controller.abort();
 },[apiFetch,cardToken,retry]);
 if(card)return <section aria-label="待加入色卡" className="rounded-lg border border-blue-200 bg-blue-50 p-3"><p className="font-medium">已识别色卡：{card.cardNo}</p><p className="mt-1 text-sm">请新建或编辑客户选样单，再确认加入色卡。</p><button type="button" className="mt-2 rounded border bg-white px-3 py-2 text-sm" onClick={()=>setViewing(true)}>查看色卡花型</button>{viewing&&<SampleCardPatternsDialog card={card} apiFetch={apiFetch} onClose={()=>setViewing(false)}/>}</section>;
 return <section aria-label="扫码色卡" className="rounded-xl border bg-white p-4">{error?<><p role="alert">{error}</p><button type="button" className="mt-3 rounded border px-3 py-2" onClick={()=>setRetry(n=>n+1)}>重新读取色卡</button></>:<p role="status">正在读取扫码色卡…</p>}</section>;
}

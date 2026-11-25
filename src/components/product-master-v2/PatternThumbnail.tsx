import {useState} from 'react';

export async function verifyPatternThumbnail(url:string|undefined){
 if(!url)throw Error('缩略图暂时无法读取。');
 const image=new Image();
 image.src=url;
 await image.decode();
 return url;
}

export function PatternThumbnail({url,hasImage,pending,alt,onOpen,onRetry}:{
 url?:string;hasImage:boolean;pending?:boolean;alt:string;onOpen?():void;onRetry?():Promise<string|undefined>;
}){
 const [retried,setRetried]=useState<{url?:string}|null>(null);
 const [failed,setFailed]=useState(false);
 const [retrying,setRetrying]=useState(false);
 const source=retried?retried.url:url;
 const available=source&&!failed&&!retrying;
 if(available){
  const image=<img src={source} alt={alt} className="size-full rounded object-cover" loading="lazy" onError={()=>setFailed(true)}/>;
  return onOpen?<button type="button" aria-label={'查看花型原图 '+alt} className="block size-16 rounded focus-visible:outline-2 focus-visible:outline-blue-700" onClick={event=>{event.currentTarget.focus({preventScroll:true});onOpen();}}>{image}</button>:
   <span className="block size-16">{image}</span>;
 }
 if(!hasImage||pending||retrying)return <span className="grid size-16 place-items-center rounded border border-dashed border-slate-500 bg-slate-50 px-1 text-center text-[11px] text-slate-700">
  {!hasImage?'待上传':'加载中'}
 </span>;
 return <div className="flex min-h-16 min-w-16 flex-col items-stretch justify-center rounded border border-dashed border-slate-500 px-1 text-center text-[11px] text-rose-800">
  <span>缩略图失败</span>
  <button type="button" disabled={!onRetry} aria-label={'重试缩略图 '+alt}
  className="min-h-8 rounded text-blue-800 focus-visible:outline-2 max-md:min-h-11"
  onClick={async()=>{
   setRetrying(true);
   try{setRetried({url:await onRetry?.()});setFailed(false);}
   catch{setFailed(true);}
   finally{setRetrying(false);}
  }}>重试</button>
  {onOpen&&<button type="button" aria-label={'查看花型原图 '+alt}
   onClick={event=>{event.currentTarget.focus({preventScroll:true});onOpen();}}
   className="min-h-8 rounded text-blue-800 focus-visible:outline-2 max-md:min-h-11">看原图</button>}
 </div>;
}

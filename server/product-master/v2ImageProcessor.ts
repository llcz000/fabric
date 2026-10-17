/** Process new images only. Legacy maintenance counts only legacy links and must not reclaim V2 assets. */
export async function processV2ImageJobs(worker:{runOnce():Promise<boolean>}):Promise<void>{
 for(let i=0;i<10;i++)if(!await worker.runOnce())break;
}
export function startV2ImageProcessor(worker:{runOnce():Promise<boolean>;recoverStaleJobs():Promise<number>}):()=>void{
 let busy=false,stopped=false;
 const tick=async()=>{if(busy||stopped)return;busy=true;try{await processV2ImageJobs(worker);}catch{console.warn('[V2 media] Image processing unavailable');}finally{busy=false;}};
 void worker.recoverStaleJobs().then(()=>tick()).catch(()=>console.warn('[V2 media] Recovery unavailable'));
 const timer=setInterval(()=>void tick(),1000);timer.unref();
 return()=>{stopped=true;clearInterval(timer);};
}

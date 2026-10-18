import {decodeCardPixels} from './cardPhotoScan';
export interface LiveVideo{srcObject:unknown;videoWidth:number;videoHeight:number;play():Promise<void>}
export interface CameraDeps{getUserMedia(constraints:MediaStreamConstraints):Promise<MediaStream>;readFrame(video:LiveVideo):{data:Uint8ClampedArray;width:number;height:number}|null;wait(signal:AbortSignal):Promise<void>}
const cancelled=()=>new DOMException('扫码已取消','AbortError');
const browserDeps:CameraDeps={getUserMedia:c=>navigator.mediaDevices.getUserMedia(c),readFrame(video){if(!video.videoWidth||!video.videoHeight)return null;const side=Math.min(video.videoWidth,video.videoHeight),size=Math.min(side,960),canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('当前浏览器不能读取相机画面');ctx.drawImage(video as HTMLVideoElement,(video.videoWidth-side)/2,(video.videoHeight-side)/2,side,side,0,0,size,size);return ctx.getImageData(0,0,size,size);},wait:signal=>new Promise((resolve,reject)=>{const id=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},180);function abort(){clearTimeout(id);reject(cancelled());}signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})};
/** Frames are local only. Late permission resolution also closes the acquired tracks. */
export async function readLiveCard(video:LiveVideo,signal:AbortSignal,deps:CameraDeps=browserDeps):Promise<string>{
 if(signal.aborted)throw cancelled();let stream:MediaStream|undefined,abort!:()=>void;
 const aborted=new Promise<never>((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});});
 try{
  const acquiring=deps.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}}).then(value=>{if(signal.aborted){value.getTracks().forEach(t=>t.stop());throw cancelled();}return value;});
  stream=await Promise.race([acquiring,aborted]);video.srcObject=stream;await Promise.race([video.play(),aborted]);
  while(!signal.aborted){const pixels=deps.readFrame(video);if(pixels){try{return decodeCardPixels(pixels.data,pixels.width,pixels.height);}catch(cause){if(!(cause instanceof Error)||!/^未识别|^不是有效/.test(cause.message))throw cause;}}await Promise.race([deps.wait(signal),aborted]);}
  throw cancelled();
 }finally{signal.removeEventListener('abort',abort);stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;}
}

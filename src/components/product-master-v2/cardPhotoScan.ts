import jsQR from 'jsqr';
import {readSampleCardScanToken} from '../../lib/sampleCardScanLink';
interface Bitmap{width:number;height:number;close():void}
interface Pixels{data:Uint8ClampedArray;width:number;height:number}
interface PhotoDecoder{bitmap(file:File):Promise<Bitmap>;pixels(bitmap:Bitmap):Pixels}
const abort=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Photo scan cancelled','AbortError');};
export function decodeCardPixels(data:Uint8ClampedArray,width:number,height:number):string{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1920||data.length!==width*height*4)throw Error('图片尺寸不适合识别，请重新拍照');
 const result=jsQR(data,width,height,{inversionAttempts:'attemptBoth'});
 if(!result)throw Error('未识别到二维码，请对准完整色卡二维码重新拍照');
 const token=readSampleCardScanToken(result.data);
 if(!token)throw Error('不是有效的内部色卡码，请使用实体色卡二维码');
 return token;
}
const browserDecoder:PhotoDecoder={
 bitmap:file=>createImageBitmap(file,{resizeWidth:1920,resizeHeight:1920,resizeQuality:'high'}),
 pixels:bitmap=>{
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('当前浏览器无法识别图片，请使用扫码枪或输入色卡编码');
  context.drawImage(bitmap as ImageBitmap,0,0);return context.getImageData(0,0,canvas.width,canvas.height);
 }
};
/** Local-only decode. Never upload, persist or log the photo or its private card token. */
export async function readCardPhoto(file:File,signal:AbortSignal,deps:PhotoDecoder=browserDecoder):Promise<string>{
 abort(signal);
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1)throw Error('请选择JPG、PNG或WebP图片');
 if(file.size>16*1024*1024)throw Error('图片不能超过16MB，请重新拍照');
 let bitmap:Bitmap|undefined;
 try{
  bitmap=await deps.bitmap(file);abort(signal);
  const pixels=deps.pixels(bitmap);abort(signal);
  return decodeCardPixels(pixels.data,pixels.width,pixels.height);
 }finally{bitmap?.close();}
}

import React from 'react';
import QRCode from 'qrcode';

export type SampleCardQrRenderer=React.ComponentType<{payload:string;size?:number}>;

/** Byte mode preserves the server's exact string; SVG and decoder tests use this same matrix. */
export function createCardQrMatrix(payload:string){
 if(!payload)throw Error('二维码编码文本为空');
 const modules=QRCode.create([{data:new TextEncoder().encode(payload),mode:'byte'}],{errorCorrectionLevel:'M'}).modules;
 return {size:modules.size,get:(x:number,y:number)=>Boolean(modules.get(y,x))};
}

export function SampleCardQr({payload,size=52}:{payload:string;size?:number}){
 try{
  const matrix=createCardQrMatrix(payload),margin=4,dimension=matrix.size+margin*2;
  const path:string[]=[];
  for(let y=0;y<matrix.size;y++)for(let x=0;x<matrix.size;x++)if(matrix.get(x,y))path.push('M'+(x+margin)+' '+(y+margin)+'h1v1h-1z');
  return <svg width={size} height={size} viewBox={'0 0 '+dimension+' '+dimension}
   shapeRendering="crispEdges" role="img" aria-label="色卡二维码" data-qr-payload={payload}>
   <rect width={dimension} height={dimension} fill="#fff"/><path d={path.join('')} fill="#000"/>
  </svg>;
 }catch{return <span role="alert" className="text-[10px] text-rose-700">二维码生成失败</span>;}
}


/** ExcelJS supports PNG/JPEG, while managed display variants are WebP. */
export async function companyExportImage(image:{body:Buffer;mime:string}):Promise<{body:Buffer;mime:'image/png'}>{
 if(!Buffer.isBuffer(image.body)||image.body.length>2*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(image.mime))throw Error('Current company image unavailable');
 const sharp=(await import('sharp')).default;
 // These are small printed logos/QRs; bounded PNGs also fit the browser JSON limit.
 const body=await sharp(image.body,{limitInputPixels:40_000_000,animated:false})
  .rotate().resize({width:700,height:700,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 if(body.length>2*1024*1024)throw Error('Current company image unavailable');
 return {body,mime:'image/png'};
}

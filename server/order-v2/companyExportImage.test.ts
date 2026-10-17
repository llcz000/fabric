import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {companyExportImage} from './companyExportImage';
test('actual managed WebP display variant becomes a PNG shared by Excel and print JSON',async()=>{
 const body=await sharp({create:{width:64,height:64,channels:4,background:'#156543'}}).webp().toBuffer();
 const image=await companyExportImage({body,mime:'image/webp'});
 assert.equal(image.mime,'image/png');assert.equal((await sharp(image.body).metadata()).format,'png');
 assert.equal((await sharp(image.body).metadata()).width,64);
});
test('invalid or oversized company display content fails instead of silently losing an image',async()=>{
 await assert.rejects(()=>companyExportImage({body:Buffer.from('not an image'),mime:'image/webp'}));
 await assert.rejects(()=>companyExportImage({body:Buffer.alloc(3*1024*1024),mime:'image/png'}));
});

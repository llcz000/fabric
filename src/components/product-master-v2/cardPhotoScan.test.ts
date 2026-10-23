import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import sharp from 'sharp';
import {decodeCardPixels,readCardPhoto} from './cardPhotoScan';

test('real URL QR pixels are accepted by the live scanner and return the same private stable token',async()=>{
 const payload='Stable_card_token_0123456789_AbCd';
 const png=await QRCode.toBuffer('https://124.223.97.60/#/cards?scan='+payload,{width:512,margin:4});
 const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(decodeCardPixels(new Uint8ClampedArray(data),info.width,info.height),payload);
});

test('a real physical-card QR image decodes locally without converting its stable payload',async()=>{
 const payload='A'.repeat(43);
 const png=await QRCode.toBuffer(payload,{width:512,margin:3});
 const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(decodeCardPixels(new Uint8ClampedArray(data),info.width,info.height),payload);
 assert.throws(()=>decodeCardPixels(new Uint8ClampedArray(16),2,2),/未识别/);
 const foreign=await QRCode.toBuffer('https://example.test/customer',{width:512});
 const bad=await sharp(foreign).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.throws(()=>decodeCardPixels(new Uint8ClampedArray(bad.data),bad.info.width,bad.info.height),/内部色卡/);
});
test('photo bounds reject before decode and decoded bitmap always closes, including cancellation',async()=>{
 let opened=0,closed=0;
 const controller=new AbortController();
 const deps={bitmap:async()=>{opened++;return {width:800,height:600,close(){closed++;}};},pixels:()=>({data:new Uint8ClampedArray(4),width:1,height:1})};
 await assert.rejects(readCardPhoto(new File(['x'],'x.txt',{type:'text/plain'}),controller.signal,deps),/图片/);
 await assert.rejects(readCardPhoto(new File([new Uint8Array(17*1024*1024)],'x.png',{type:'image/png'}),controller.signal,deps),/16/);
 assert.equal(opened,0);
 await assert.rejects(readCardPhoto(new File(['x'],'x.png',{type:'image/png'}),controller.signal,deps),/未识别/);
 assert.equal(closed,1);
 const cancelled={...deps,bitmap:async()=>{controller.abort();return deps.bitmap();}};
 await assert.rejects(readCardPhoto(new File(['x'],'x.png',{type:'image/png'}),controller.signal,cancelled),{name:'AbortError'});
 assert.equal(closed,2);
});

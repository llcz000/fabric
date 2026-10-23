import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import test from 'node:test';
import {galleryVersions,PatternOriginalViewer} from './PatternOriginalViewer';
import type {PatternVersionItem} from './patternModel';
const version=(id:string,masterId:string,no:number,asset:string|null='a1111111-1111-4111-8111-111111111111'):PatternVersionItem=>({
 id,masterId,colorwayNo:no,patternNo:'G0008-'+no,patternImageAssetId:asset,isActive:true,remark:'',colorTags:[]
});
test('original viewer only traverses the opened master; absent images skipped, siblings sorted',()=>{
 const curr=version('2','11',2);
 const others=[version('5','22',1),version('4','11',4),version('1','11',1),version('3','11',3,null),curr];
 assert.deepEqual(galleryVersions(curr,others).map(v=>v.colorwayNo),[1,2,4]);
});
test('multi-colorway gallery exposes directional buttons and count',()=>{
 const versions=[version('1','11',1),version('2','11',2)];
 const html=renderToStaticMarkup(React.createElement(PatternOriginalViewer,{
  current:versions[0],versions,original:'data:image/png;base64,xxx',error:'',onChange:()=>{},onClose:()=>{}
 }));
 assert(html.includes('上一配色原图')&&html.includes('下一配色原图')&&html.includes('1/2'));
 assert(html.includes('role="dialog"')&&html.includes('关闭原图'));
});
test('single-image gallery hides directional controls',()=>{
 const single=version('1','11',1);
 const html=renderToStaticMarkup(React.createElement(PatternOriginalViewer,{
  current:single,versions:[single,version('2','11',2,null)],original:null,error:'',onChange:()=>{},onClose:()=>{}
 }));
 assert(!html.includes('上一配色原图')&&!html.includes('下一配色原图'));
});

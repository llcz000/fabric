import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BatchSelectedColorways} from './BatchSelectedColorways';
import type {ProductPatternChoice} from './productEditorModel';

const a='a1111111-1111-4111-8111-111111111111';
const b='a2222222-2222-4222-8222-222222222222';
const items:ProductPatternChoice[]=[{
 id:'12',masterId:'11',colorwayNo:1,patternNo:'G0008-1',
 patternImageAssetId:a,remark:'',isActive:true,colorTags:[],topicTags:[]
},{
 id:'13',masterId:'11',colorwayNo:2,patternNo:'G0008-2',
 patternImageAssetId:b,remark:'',isActive:true,colorTags:[],topicTags:[]
},{
 id:'14',masterId:'11',colorwayNo:3,patternNo:'G0008-3',
 patternImageAssetId:null,remark:'',isActive:true,colorTags:[],topicTags:[]
}];
test('batch selected products keep thumbnails aligned with selected colorway and remove actions',()=>{
 const html=renderToStaticMarkup(React.createElement(BatchSelectedColorways,{
  items,urls:new Map([[a,'https://signed.example/a.webp'],[b,'https://signed.example/b.webp']]),
  failedIds:new Set(),onRemove:()=>{}
 }));
 assert.equal((html.match(/<img /g)||[]).length,2);
 assert.equal((html.match(/<li /g)||[]).length,3);
 const li=[...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(match=>match[0]);
 assert(li[0].includes('G0008-1')&&li[0].includes('https://signed.example/a.webp'));
 assert(li[1].includes('G0008-2')&&li[1].includes('https://signed.example/b.webp'));
 assert(li[2].includes('G0008-3')&&!li[2].includes('<img '));
 assert(html.includes('已选花型配色 G0008-1 缩略图'));
 for(const label of ['移除 G0008-1','移除 G0008-2','移除 G0008-3'])assert(html.includes('aria-label="'+label+'"'));
 assert(html.includes('花型图片未上传'));
});
test('failed signed image stays placeholder and does not block removal',()=>{
 const html=renderToStaticMarkup(React.createElement(BatchSelectedColorways,{
  items:items.slice(0,1),urls:new Map([[a,'https://signed.example/a.webp']]),
  failedIds:new Set(['12']),onRemove:()=>{},disabled:false
 }));
 assert(!html.includes('<img '));
 assert(html.includes('花型图片暂不可用')&&html.includes('移除 G0008-1'));
});

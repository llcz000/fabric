import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {PublicCard} from '../../../server/customer-share/cardShareCatalog';
import {PublicCardGallery} from './PublicCardGallery';
import {PublicProductImage} from './PublicProductImage';

const firstRef='display:'+'x'.repeat(43);
const nextRef='display:'+'y'.repeat(43);
const safeCard:PublicCard={cardNo:'G008-F022',fabricNo:'F022',fabricName:'轻薄雪纺',
 composition:'聚酯纤维 100%',weightValue:80,weightUnit:'gsm',widthCm:145,
 colorways:[
  {colorwayNo:1,productNo:'G008-1-F022',displayImages:[{previewRef:firstRef}],detailImages:[{previewRef:nextRef}],effectImages:[]},
  {colorwayNo:2,productNo:'G008-2-F022',displayImages:[],detailImages:[],effectImages:[]},
 ]};
test('mobile WeChat H5 card shows compact intro, 44px colorway navigation and separately grouped images',()=>{
 const refs:string[]=[];
 const primary:boolean[]=[];
 const html=renderToStaticMarkup(React.createElement(PublicCardGallery,{
  card:safeCard,
  renderPreview:(ref,description,priority)=>{refs.push(ref);primary.push(Boolean(priority));
   return React.createElement('img',{alt:description,src:'/safe-preview.jpg'});
  },
 }));
 assert.match(html,/G008-F022/);assert.match(html,/145 cm/);assert.match(html,/80 gsm/);
 assert.match(html,/min-h-11/);assert.match(html,/href="#colorway-1"/);assert.match(html,/href="#colorway-2"/);
 for(const label of ['配色 1','配色 2','面料大图','细节图','效果图','暂无图片'])assert(html.includes(label),label);
 assert.deepEqual(refs,[firstRef,nextRef]);assert.deepEqual(primary,[true,false]);
 assert.equal((html.match(/<img/g)||[]).length,2);
 assert.doesNotMatch(html,/display:[A-Za-z0-9_-]{20,}/);
 assert.doesNotMatch(html,/删除|编辑资料|内部选样|定金单|客户价格/);
});
test('unavailable/empty card shows only safe message and no previews',()=>{
 const html=renderToStaticMarkup(React.createElement(PublicCardGallery,{card:{...safeCard,colorways:[]}}));
 assert.match(html,/暂不可用/);assert.doesNotMatch(html,/F022/);
});
test('first authorized product image can be eager/high priority, others remain lazy and zoomable',()=>{
 const src='/api/public/cards/'+'a'.repeat(43)+'/images/'+'b'.repeat(43);
 const eager=renderToStaticMarkup(React.createElement(PublicProductImage,{src,description:'面料整体',priority:true}));
 const lazy=renderToStaticMarkup(React.createElement(PublicProductImage,{src,description:'面料细节'}));
 assert.match(eager,/loading="eager"/);assert.match(eager,/fetchPriority="high"/);
 assert.match(lazy,/loading="lazy"/);assert.match(lazy,/fetchPriority="auto"/);
 for(const html of [eager,lazy]){assert.match(html,/查看大图/);assert.doesNotMatch(html,/original/);}
});

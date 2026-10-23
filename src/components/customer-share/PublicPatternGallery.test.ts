import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {projectPublicPattern,type PatternCandidate} from '../../../server/customer-share/publicPatternProjection';
import {PublicPatternGallery} from './PublicPatternGallery';

const yes={isActive:true,isPublicApproved:true};
const image=(role:string,ref:string)=>({...yes,kind:'display',role,previewRef:'display:'+ref,privateUrl:'https://private.example/original.png'});
const input=():PatternCandidate=>({...yes,patternNo:'0012',price:999,customerName:'PRIVATE_CUSTOMER',
 colorways:[
  {...yes,colorwayNumber:1,designImages:[image('design','design-one')],products:[
   {...yes,fabric:{...yes,fabricNo:'F018',fabricName:'丝绸',composition:'丝100%',weightValue:16,weightUnit:'mm',widthCm:140},images:[image('display','silk'),image('detail','silk-detail')]},
   {...yes,fabric:{...yes,fabricNo:'F019',fabricName:'棉麻',composition:null,weightValue:120,weightUnit:'gsm',widthCm:150},images:[image('effect','cotton-effect')]},
  ]},
  {...yes,colorwayNumber:2,designImages:[image('design','design-two')],products:[]}
]});
const html=(candidate:PatternCandidate|null,renderPreview?:(ref:string,alt:string)=>React.ReactNode)=>
 renderToStaticMarkup(React.createElement(PublicPatternGallery,{pattern:candidate?projectPublicPattern(candidate):null,renderPreview}));

test('product share labels the selected product and three image roles without pattern design or sibling selectors',()=>{
 const projected=projectPublicPattern(input())!;projected.colorways=projected.colorways.slice(0,1);projected.colorways[0].fabrics=projected.colorways[0].fabrics.slice(0,1);
 const text=renderToStaticMarkup(React.createElement(PublicPatternGallery,{pattern:projected,productNo:'0012-1-F018',renderPreview:(_ref,alt)=>React.createElement('img',{alt})}));
 for(const label of ['花型产品 0012-1-F018','面料大图','细节图','效果图','丝100%'])assert(text.includes(label),label);
 assert(!text.includes('选择花型配色'));assert(!text.includes('花型设计图'));assert(!text.includes('F019'));
 assert(!text.includes('max-w-[240px]'),'product photos should use the page width instead of tiny pattern preview strips');
});
test('unavailable product page explains product availability without referring to missing pattern colorways',()=>{
 const text=renderToStaticMarkup(React.createElement(PublicPatternGallery,{pattern:null,productOnly:true}));
 assert(text.includes('该产品当前暂不可用'));assert(!text.includes('可展示的配色'));
});

test('B1 public H5 read-only gallery shows current version and each fabric specific specs without leaking candidate fields',()=>{
 const text=html(input());
 for(const label of ['花型 0012','配色 1','配色 2','F018','丝绸','16 mm','140 cm','F019','棉麻','120 gsm','150 cm','面料实拍','花型设计图'])assert(text.includes(label),label);
 assert(!text.includes('PRIVATE_CUSTOMER'));assert(!text.includes('999'));
 assert(!text.includes('https://private.example'));assert(!text.includes('display:design-one'));
 assert(!text.includes('扫码'));assert(!text.includes('下单'));
});
test('B1 disabled master or all unavailable colorways renders only 暂不可用 with no private visuals',()=>{
 const disabled=input();disabled.isActive=false;
 assert(html(disabled).includes('暂不可用'));
 assert(!html(disabled).includes('丝绸'));
 const empty=input();empty.colorways.forEach(c=>c.isActive=false);
 const output=html(empty);
 assert(output.includes('暂不可用'));assert(!output.includes('花型设计图'));assert(!output.includes('F018'));
});
test('B1 preview is only a trusted renderer callback, and inactive versions never get a media callback',()=>{
 const c=input();c.colorways[1].isActive=false;
 const refs:string[]=[];
 const output=html(c,(ref,alt)=>{refs.push(ref);return React.createElement('img',{src:'/approved-thumbnail',alt});});
 assert(refs.includes('display:design-one'));
 assert(refs.includes('display:silk'));
 assert(!refs.includes('display:design-two'));
 assert(output.includes('/approved-thumbnail'));
 assert(!output.includes('display:'));
});
test('B1 missing or unauthorized preview renderer uses placeholders, never emits raw storage paths',()=>{
 const output=html(input(),()=>null);
 assert(output.includes('暂无可展示图片'));
 assert(!output.includes('<img'));
 assert(!output.includes('private.example'));
});

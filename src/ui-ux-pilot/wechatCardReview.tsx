import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../.agent-workspaces/v2-quality-20261020/src/index.css';
import './wechatReview.css';
import {PublicCardGallery} from '../../.agent-workspaces/v2-quality-20261020/src/components/customer-share/PublicCardGallery';
import {PublicProductImage} from '../../.agent-workspaces/v2-quality-20261020/src/components/customer-share/PublicProductImage';
import type {PublicCard} from '../../.agent-workspaces/v2-quality-20261020/server/customer-share/cardShareCatalog';

/** Local browser fixture: real approved view component, synthetic data and data: pictures. */
const make=(str:string)=>({previewRef:'display:'+str.repeat(43)});
const preview:PublicCard={
 cardNo:'G0886-F018',fabricNo:'F018',fabricName:'轻薄雪纺',composition:'聚酯纤维 100%',
 weightValue:80,weightUnit:'gsm',widthCm:145,
 colorways:[
  {colorwayNo:1,productNo:'G0886-1-F018',displayImages:[make('a'),make('b')],detailImages:[make('c')],effectImages:[make('d')]},
  {colorwayNo:2,productNo:'G0886-2-F018',displayImages:[make('e')],detailImages:[],effectImages:[make('f')]},
  {colorwayNo:3,productNo:'G0886-3-F018',displayImages:[make('g')],detailImages:[make('h')],effectImages:[make('i')]}
 ]
};
const style=(ref:string)=>{const palette=['#d79993','#b5bd9c','#e0ba9b','#8997a2'];const i=Math.max(0,ref.charCodeAt(8)-97)%4;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 440"><rect width="600" height="440" fill="'+palette[i]+'"/><path d="M0 140Q100 40 190 180T380 210T600 140L600 440H0Z" fill="#f0e1cb" opacity=".63"/><path d="M0 60Q130 300 270 100T600 110" stroke="#57766d" stroke-width="55" fill="none" opacity=".35"/><text x="300" y="397" text-anchor="middle" font-family="sans-serif" font-size="19" fill="#3c4141">DEMO ONLY · NOT REAL FABRIC</text></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
};
createRoot(document.getElementById('root')!).render(<React.StrictMode>
 <div style={{background:'#fff6e9',fontSize:12,textAlign:'center',padding:'8px 14px',color:'#795923'}}>本机样板 · 模拟数据和图像 · 不是可发送客户的正式链接</div>
 <PublicCardGallery card={preview} renderPreview={(ref,description,priority)=><PublicProductImage src={style(ref)} description={description} priority={priority}/>}/>
 </React.StrictMode>);

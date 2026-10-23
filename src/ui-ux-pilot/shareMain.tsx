import React from 'react';
import {createRoot} from 'react-dom/client';
import {PILOT_CARDS} from './demoCards';
import './shareDemo.css';

const id=new URLSearchParams(window.location.search).get('demoCard');
const card=PILOT_CARDS.find(c=>c.id===id);
const media=['面料整体','面料细节','应用效果'] as const;
function Visual({master,color=0}:{master:string;color?:number}){
 return <div className="share-art" data-pattern={master} data-color={color%3} role="img" aria-label="演示印花占位图，非真实产品图片"><small>DEMO ART · 非真实素材</small></div>;
}
function ClientPreview(){
 if(!card)return <main className="share-not-found"><h1>该演示色卡不存在</h1><p>请从本机内部色卡样板打开有效的演示链接。本页不包含真实客户分享数据。</p></main>;
 return <div className="share-page" data-view="customer-demo">
  <header className="share-header"><div className="share-brand">FABRIC <span>COLLECTION</span></div><span>色卡分享展示 · 本地演示</span></header>
  <main className="share-container">
   <section className="share-hero"><div className="share-hero-copy">
    <p className="share-eyebrow">PATTERN COLLECTION / {card.masterNo}</p>
    <h1>花型与面料<span>作品档案</span></h1>
    <p>通过一张色卡，了解不同配色与面料应用。以下仅展示客户浏览版式，所有图像和数据均为演示。</p>
    <div className="share-spec"><span><strong>{card.masterNo}</strong>花型编号</span><span><strong>{card.fabricName}</strong>面料品名</span><span><strong>{card.composition}</strong>面料成分</span><span><strong>{card.weight}</strong>克重/规格</span></div>
   </div><Visual master={card.masterNo}/></section>
   <section className="share-section" aria-label="花型配色展示">
    <div className="share-section-head"><div><span>01 / COLORWAYS</span><h2>花型配色</h2></div><p>{card.colors.length} 款配色</p></div>
    <div className="share-colorways">{card.colors.map((color,i)=><article key={color}><Visual master={card.masterNo} color={i}/><strong>{color}</strong></article>)}</div>
   </section>
   <section className="share-section" aria-label="关联产品媒体展示">
    <div className="share-section-head"><div><span>02 / FABRIC & LOOKS</span><h2>面料与应用展示</h2></div><p>{card.products.length} 款关联产品</p></div>
    <div className="share-products">{card.products.map((product,i)=><article className="share-product" key={product.no}>
     <div className="share-product-head"><div><small>FABRIC #{String(i+1).padStart(2,'0')}</small><h3>{product.name}</h3><span>{product.no}</span></div><div className="share-product-info">{card.fabricName} · {card.composition}</div></div>
     <div className="share-media">{media.map((kind,j)=><div key={kind} className="share-media-item"><Visual master={card.masterNo} color={i+j}/><div><strong>{kind}</strong><span>{product.media[j]} 张 · 演示图</span></div></div>)}</div>
    </article>)}</div>
   </section>
   <p className="share-notice">本页面仅为本机客户链接展示设计样板，未生成公开分享地址，所有图案均为视觉占位示意，不可对客户发送。</p>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ClientPreview/></React.StrictMode>);

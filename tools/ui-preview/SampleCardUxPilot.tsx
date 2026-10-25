import React,{useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {Search,Image as ImageIcon,Share2,QrCode,ExternalLink} from 'lucide-react';
import {SampleCardQr} from '../../src/components/product-master-v2/SampleCardLibraryV2';
import {PILOT_CARDS,type DemoCard} from './demoCards';
import './SampleCardUxPilot.css';

type Action='patterns'|'share'|'qr';
type Active={cardId:string;action:Action};
export {PILOT_CARDS} from './demoCards';
const mediaLabels=['面料图','细节图','效果图'] as const;
function Swatch({masterNo,color=0}:{masterNo:string;color?:number}){
 return <span className="ux-swatch" data-pattern={masterNo} data-color={color%3} role="img" aria-label={masterNo+' 演示图案，非真实素材'}/>;
}
function CardActions({card,onOpen}:{card:DemoCard;onOpen:(e:React.MouseEvent<HTMLButtonElement>,id:string,action:Action)=>void}){
 return <div className="ux-actions">
  <button type="button" className="ux-action" aria-label={'查看花型 '+card.cardNo} onClick={e=>onOpen(e,card.id,'patterns')}><ImageIcon size={14} aria-hidden="true"/>查看花型</button>
  <button type="button" className="ux-action ux-action--primary" aria-label={'分享预览 '+card.cardNo} onClick={e=>onOpen(e,card.id,'share')}><Share2 size={14} aria-hidden="true"/>分享预览</button>
  <button type="button" className="ux-action" aria-label={'查看二维码 '+card.cardNo} onClick={e=>onOpen(e,card.id,'qr')}><QrCode size={14} aria-hidden="true"/>二维码</button>
 </div>;
}
export function SampleCardUxPilot(){
 const [query,setQuery]=useState('');
 const [active,setActive]=useState<Active|null>(null);
 const [feedback,setFeedback]=useState('');
 const returnFocus=useRef<HTMLButtonElement|null>(null);
 const cards=useMemo(()=>PILOT_CARDS.filter(c=>[c.cardNo,c.masterNo,c.fabricNo,c.fabricName].some(s=>s.toLowerCase().includes(query.trim().toLowerCase()))),[query]);
 const card=active?PILOT_CARDS.find(c=>c.id===active.cardId):undefined;
 const customerPreview=card?new URL('/tools/ui-preview/entries/ui-ux-share-demo.html?demoCard='+encodeURIComponent(card.id),window.location.origin).toString():'';
 function open(e:React.MouseEvent<HTMLButtonElement>,id:string,action:Action){returnFocus.current=e.currentTarget;setFeedback('');setActive({cardId:id,action});}
 async function copyDemoLink(){
  try{await navigator.clipboard.writeText(customerPreview);setFeedback('本机客户展示样板链接已复制，仅用于本机评审。');}
  catch{setFeedback('复制失败：请通过“打开客户展示样板”在本机查看。');}
 }
 const title=active?.action==='patterns'?'查看花型与配色':active?.action==='share'?'色卡关联产品 · 分享预览':'查看色卡二维码';
 return <div className="ux-pilot" data-ux-pilot="sample-card" data-view="internal">
  <main className="ux-frame">
   <header className="ux-heading"><div><h1>色卡库 <span>内部工作台样板</span></h1><p>按色卡、花型和面料快速查询；客户实际看到的是独立分享页面。</p></div><div className="ux-total">{PILOT_CARDS.length} 张演示色卡</div></header>
   <section className="ux-toolbar" aria-label="色卡搜索筛选">
    <div className="ux-search-wrap"><label htmlFor="pilot-card-search">搜索色卡 · 花型 · 面料</label>
     <div className="ux-search-field"><Search size={16} aria-hidden="true"/><input id="pilot-card-search" type="search" aria-label="查找色卡、花型或面料" value={query} placeholder="输入色卡编号、花型编号或面料名称" onChange={e=>setQuery(e.target.value)}/></div>
    </div>
    <span className="ux-result-count" role="status">找到 {cards.length} 张色卡，共 {PILOT_CARDS.length} 张演示色卡</span>
    <button type="button" className="ux-quiet-btn" disabled={!query} onClick={()=>setQuery('')}>清除筛选</button>
   </section>
   {cards.length===0?<section className="ux-empty"><h2>没有符合条件的色卡</h2><p>可更换编号或清除筛选查看全部记录。</p><button className="ux-quiet-btn" type="button" onClick={()=>setQuery('')}>查看全部色卡</button></section>:
   <section className="ux-list">
    <div className="ux-table-scroll" role="region" aria-label="色卡数据表，可横向滚动" tabIndex={0}>
     <table className="ux-table"><thead><tr><th scope="col">花型</th><th scope="col">色卡编号</th><th scope="col">花型母版</th><th scope="col">面料信息</th><th scope="col">产品</th><th scope="col">操作</th></tr></thead>
      <tbody>{cards.map(c=><tr key={c.id}><td><div className="ux-thumb"><Swatch masterNo={c.masterNo}/></div></td><td><strong>{c.cardNo}</strong></td><td>{c.masterNo}<small>{c.colors.length} 配色</small></td><td>{c.fabricNo} · {c.fabricName}<small>{c.composition} / {c.weight}</small></td><td>{c.products.length} 款</td><td><CardActions card={c} onOpen={open}/></td></tr>)}</tbody>
     </table>
    </div>
    <div className="ux-mobile-list" aria-label="手机色卡列表">{cards.map(c=><article key={c.id} className="ux-mobile-row">
     <div className="ux-thumb"><Swatch masterNo={c.masterNo}/></div><div className="ux-mobile-text"><strong>{c.cardNo}</strong><span>{c.masterNo} · {c.colors.length} 配色</span><span>{c.fabricNo} {c.fabricName} · {c.products.length} 款</span><CardActions card={c} onOpen={open}/></div>
    </article>)}</div>
   </section>}
   <p className="ux-note">当前页面仅为内部交互样板，图案为 CSS 占位效果，未使用真实面料图、客户资料或生产接口。</p>
  </main>
  <Dialog.Root open={Boolean(active&&card)} onOpenChange={v=>{if(!v)setActive(null);}}>
   <Dialog.Portal><Dialog.Overlay className="ux-modal-overlay"/>
    <Dialog.Content className="ux-modal" onCloseAutoFocus={e=>{e.preventDefault();returnFocus.current?.focus();}}>
     <header className="ux-modal-head"><div><Dialog.Title asChild><h2>{title}</h2></Dialog.Title><Dialog.Description asChild><p>{card?.cardNo} · {card?.fabricNo} {card?.fabricName} · 本机模拟数据</p></Dialog.Description></div><Dialog.Close asChild><button type="button" className="ux-modal-close" aria-label="关闭预览">关闭</button></Dialog.Close></header>
     <div className="ux-modal-body">
      {card&&active?.action==='patterns'?<><p className="ux-dialog-lead">当前母版共有 {card.colors.length} 个配色，实际业务中应按编号显示真实花型缩略图。</p>
       <div className="ux-colorway-grid">{card.colors.map((color,i)=><article key={color} className="ux-colorway"><Swatch masterNo={card.masterNo} color={i}/><strong>{color}</strong><small>花型示意</small></article>)}</div></>:null}
      {card&&active?.action==='share'?<><p className="ux-dialog-lead">此色卡关联 {card.products.length} 款产品。客户点击公开分享链接后，应看到以下产品的面料图、细节图、效果图及面料规格。</p>
       <div className="ux-product-stack">{card.products.map((product,i)=><section className="ux-product" key={product.no} aria-label={'关联产品 '+product.no}>
        <div><strong>{product.no}</strong><span>{product.name}</span></div>
        <div className="ux-media-grid">{mediaLabels.map((name,j)=><div className="ux-media-item" key={name}><Swatch masterNo={card.masterNo} color={i+j}/><strong>{name}</strong><span>{product.media[j]} 张 · 示意</span></div>)}</div>
       </section>)}</div>
       <div className="ux-share-actions"><a href={customerPreview} target="_blank" rel="noreferrer" className="ux-action ux-action--primary"><ExternalLink size={14} aria-hidden="true"/>打开客户展示样板</a><button type="button" className="ux-action" onClick={()=>void copyDemoLink()}>复制本机演示链接</button></div>
       <p className="ux-warning">本机演示链接不是客户公开分享链接；不得发送客户。未验证生产链接权限或二维码。</p>
       {feedback?<p role="status" className="ux-feedback">{feedback}</p>:null}</>:null}
      {card&&active?.action==='qr'?<div className="ux-qr-view"><SampleCardQr payload={'DEMO-ONLY-'+card.id} size={208}/><strong>{card.cardNo}</strong><p>二维码编码为 DEMO-ONLY 示例，不包含正式色卡密钥；不可用于扫码选样或向客户分享。</p></div>:null}
     </div>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 </div>;
}

import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
import {Menu,X,LayoutDashboard,FileText,Plus,SwatchBook,Layers,Package,ScanLine,Users,Settings,Archive,LogOut,type LucideIcon} from 'lucide-react';
import type {V2View} from './v2Navigation';
import type {V2AppPrincipal} from './v2AppModel';
import './v2Experience.css';
const groups:{label:string;items:[V2View,string,LucideIcon][]}[]=[{label:'工作台',items:[['stats','经营大盘',LayoutDashboard]]},{label:'业务',items:[['documents','单据列表',FileText],['create','新增单据',Plus],['samples','客户选样',Users],['customers','客户档案',Users],['inventory','库存',Archive]]},{label:'产品资料',items:[['pattern','花型库',SwatchBook],['fabric','面料库',Layers],['products','产品库',Package],['cards','色卡库',ScanLine]]},{label:'系统',items:[['settings','开单设置',Settings],['members','成员管理',Users]]}];
export function V2Shell({actor,view,onNavigate,onLogout,children,blocked=false}:{actor:V2AppPrincipal;view:V2View;onNavigate(view:V2View):void;onLogout():void;children:React.ReactNode;blocked?:boolean}){
 const [open,setOpen]=useState(false),toggle=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const keydown=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();setOpen(false);}
   if(e.key==='Tab'){
    const controls=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')??[]);
    const first=controls[0],last=controls.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  };
  document.addEventListener('keydown',keydown);return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;(toggle.current??previous)?.focus();};
 },[open]);
 const title=view==='preview'?'单据预览':groups.flatMap(g=>g.items).find(item=>item[0]===view)?.[1]??'Fabric';
 return <div className="v2-shell" inert={blocked||undefined}>
  <a className="v2-skip" href="#fabric-main" onClick={e=>{e.preventDefault();document.getElementById('fabric-main')?.focus();}}>跳到主要内容</a>
  {open&&<button className="v2-nav-backdrop" aria-label="关闭导航菜单" onClick={()=>setOpen(false)} tabIndex={-1}/>}
  <aside ref={panel} className="v2-sidebar" data-open={open} role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-label="Fabric 导航菜单">
   <div className="v2-brand"><span className="v2-brand-mark" aria-hidden="true">F</span><strong>Fabric</strong><button className="v2-menu-toggle" aria-label="关闭导航菜单" onClick={()=>setOpen(false)}><X size={20}/></button></div>
   <nav aria-label="主导航">{groups.map(group=><div className="v2-nav-group" key={group.label}><p>{group.label}</p>{group.items.filter(([id])=>id!=='members'||actor.role==='admin').map(([id,label,Icon])=><button type="button" key={id} aria-current={id===view?'page':undefined} onClick={()=>{setOpen(false);onNavigate(id);}}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>)}</div>)}</nav>
   <div className="v2-sidebar-account" aria-label="当前登录账号"><div className="v2-sidebar-user"><strong title={actor.displayName}>{actor.displayName}</strong><small>{actor.role==='admin'?'管理员':'业务员'}</small></div><button type="button" onClick={onLogout} aria-label="退出登录" title="退出登录"><LogOut size={18} aria-hidden="true"/></button></div>
  </aside>
  <div className="v2-body" inert={open||undefined}>
   <header className="v2-topbar"><div className="v2-topbar-title"><button ref={toggle} type="button" className="v2-menu-toggle" aria-label="打开导航菜单" aria-expanded={open} onClick={()=>setOpen(true)}><Menu size={22}/></button><span>{title}</span></div></header>
   <main id="fabric-main" tabIndex={-1} className="v2-content">{children}</main>
  </div>
 </div>;
}
export function V2DiscardDialog({onCancel,onDiscard}:{onCancel():void;onDiscard():void}){
 const panel=useRef<HTMLDivElement>(null),cancel=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const before=document.activeElement as HTMLElement|null;cancel.current?.focus();
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onCancel();}if(e.key==='Tab'){const buttons=Array.from(panel.current?.querySelectorAll('button')??[]);if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus();}}};
  document.addEventListener('keydown',keydown);return()=>{document.removeEventListener('keydown',keydown);before?.focus?.();};
 },[onCancel]);
 return <div className="v2-modal-backdrop"><div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description" className="v2-discard-dialog"><h2 id="discard-title">有尚未保存的修改</h2><p id="discard-description">离开后，本页未保存的修改将丢失。你可以继续编辑，或放弃修改后离开。</p><div><button ref={cancel} type="button" onClick={onCancel}><ActionIcon name="edit"/>继续编辑</button><button type="button" className="v2-danger" onClick={onDiscard}><ActionIcon name="delete"/>放弃修改</button></div></div></div>;
}

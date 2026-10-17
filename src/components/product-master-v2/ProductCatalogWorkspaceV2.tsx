import React,{useState} from 'react';
import type {CatalogImageResolver} from './ProductImageTabs';
import {ProductCatalogV2} from './ProductCatalogV2';
import {ProductEditorV2} from './ProductEditorV2';
import type {ImageRole} from './productEditorModel';
import type {CatalogProduct} from './catalogModel';

/** Unmounted integration shell for P4-4 list -> P4-5 create/edit -> list.
 * Does not touch the legacy ProductLibrary or production App routes.
 */
export interface ProductCatalogWorkspaceV2Props{
 apiFetch:typeof fetch;canManage?:boolean;
 resolveImages?:CatalogImageResolver;
 onUploadImage?(file:File,role:ImageRole):Promise<string>;
 onPatternLibrary?():void;onFabricLibrary?():void;
}
type View={type:'list'}|{type:'create'}|{type:'edit';id:string};
export function ProductCatalogWorkspaceV2({apiFetch,canManage=false,onUploadImage,
 onPatternLibrary,onFabricLibrary,resolveImages}:ProductCatalogWorkspaceV2Props){
 const [view,setView]=useState<View>({type:'list'});
 const [refresh,setRefresh]=useState(0);
 const [savedCode,setSavedCode]=useState('');
 if(view.type!=='list'){
  return <ProductEditorV2 key={view.type==='edit'?view.id:'new'} apiFetch={apiFetch}
   mode={view.type} productId={view.type==='edit'?view.id:undefined} canManage={canManage}
   onUploadImage={onUploadImage} onPatternLibrary={onPatternLibrary} onFabricLibrary={onFabricLibrary}
   onCancel={()=>setView({type:'list'})}
   onSaved={item=>{setSavedCode(item.productNo);setRefresh(n=>n+1);setView({type:'list'});}}/>;
 }
 return <>
  {savedCode?<p role="status" className="m-3 rounded border border-emerald-200 bg-white p-2 text-xs text-emerald-700">
   产品已保存：{savedCode}</p>:null}
  <ProductCatalogV2 key={refresh} apiFetch={apiFetch} canManage={canManage} resolveImages={resolveImages}
   onCreate={canManage?()=>{setSavedCode('');setView({type:'create'});}:undefined}
   onEdit={canManage?(item:CatalogProduct)=>{setSavedCode('');setView({type:'edit',id:item.id});}:undefined}/>
 </>;
}
export default ProductCatalogWorkspaceV2;

import React,{useState} from 'react';
import type {CatalogImageResolver} from './ProductImageTabs';
import {ProductCatalogV2} from './ProductCatalogV2';
import {ProductEditorV2} from './ProductEditorV2';
import {ProductBatchCreateV2} from './ProductBatchCreateV2';
import type {ImageRole} from './productEditorModel';
import type {CatalogProduct} from './catalogModel';

/** Unmounted integration shell for P4-4 list -> P4-5 create/edit -> list.
 * Does not touch the legacy ProductLibrary or production App routes.
 */
export interface ProductCatalogWorkspaceV2Props{
 apiFetch:typeof fetch;canManage?:boolean;
 resolveImages?:CatalogImageResolver;
 onUploadImage?(file:File,role:ImageRole):Promise<string>;
 onDeleteProduct?(product:CatalogProduct):Promise<void>;
 onEditorStateChange?(active:boolean):void;
 onShare?(product:CatalogProduct):void;
 onPatternLibrary?():void;onFabricLibrary?():void;
 initialPatternId?:string;initialPatternNo?:string;initialBatchMasterId?:string;onExitPrefill?():void;
}
type View={type:'list'}|{type:'create'}|{type:'batch'}|{type:'edit';id:string};
export function ProductCatalogWorkspaceV2({apiFetch,canManage=false,onUploadImage,
 onPatternLibrary,onFabricLibrary,onDeleteProduct,onEditorStateChange,onShare,resolveImages,initialPatternId,initialPatternNo,initialBatchMasterId,onExitPrefill}:ProductCatalogWorkspaceV2Props){
 const [view,setView]=useState<View>(()=>initialBatchMasterId?{type:'batch'}:initialPatternId&&initialPatternNo?{type:'create'}:{type:'list'});
 const [refresh,setRefresh]=useState(0);
 const [savedCode,setSavedCode]=useState('');
 if(view.type==='batch')return <ProductBatchCreateV2 apiFetch={apiFetch} initialMasterId={initialBatchMasterId}
  onCancel={()=>{if(initialBatchMasterId&&onExitPrefill){onExitPrefill();return;}setView({type:'list'});onEditorStateChange?.(false);}}
  onSaved={result=>{setSavedCode('已批量新增 '+result.created.length+' 个产品，跳过 '+result.skipped.length+' 个已有组合');setRefresh(n=>n+1);if(initialBatchMasterId&&onExitPrefill){onExitPrefill();return;}setView({type:'list'});onEditorStateChange?.(false);}}/>;
 if(view.type!=='list'){
  return <ProductEditorV2 key={view.type==='edit'?view.id:'new'} apiFetch={apiFetch}
   mode={view.type} productId={view.type==='edit'?view.id:undefined} canManage={canManage}
   prefillPatternId={view.type==='create'?initialPatternId:undefined} prefillPatternNo={view.type==='create'?initialPatternNo:undefined}
   onUploadImage={onUploadImage} onPatternLibrary={onPatternLibrary} onFabricLibrary={onFabricLibrary}
   onBatchCreate={view.type==='create'?()=>{setView({type:'batch'});onEditorStateChange?.(true);}:undefined}
   onCancel={()=>{if(initialPatternId&&onExitPrefill){onExitPrefill();return;}setView({type:'list'});onEditorStateChange?.(false);}}
   onSaved={item=>{setSavedCode(item.productNo);setRefresh(n=>n+1);if(initialPatternId&&onExitPrefill){onExitPrefill();return;}setView({type:'list'});onEditorStateChange?.(false);}}/>;
 }
 return <>
  {savedCode?<p role="status" className="m-3 rounded border border-emerald-200 bg-white p-2 text-xs text-emerald-700">
   {savedCode.startsWith('已批量')?savedCode:'产品已保存：'+savedCode}</p>:null}
  <ProductCatalogV2 key={refresh} apiFetch={apiFetch} canManage={canManage} resolveImages={resolveImages} onShare={onShare}
   onCreate={canManage?()=>{setSavedCode('');setView({type:'create'});onEditorStateChange?.(true);}:undefined}
   onEdit={canManage?(item:CatalogProduct)=>{setSavedCode('');setView({type:'edit',id:item.id});onEditorStateChange?.(true);}:undefined}
   onDeleteRequest={canManage&&onDeleteProduct?async item=>{await onDeleteProduct(item);setSavedCode('');setRefresh(n=>n+1);}:undefined}/>
 </>;
}
export default ProductCatalogWorkspaceV2;

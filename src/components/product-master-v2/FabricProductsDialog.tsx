import React from 'react';
import type {FabricCatalogItem} from './fabricModel';
import {RelatedProductsDialog} from './RelatedProductsDialog';
export function FabricProductsDialog({apiFetch,fabric,onClose}:{apiFetch:typeof fetch;fabric:FabricCatalogItem;onClose():void}){
 return <RelatedProductsDialog apiFetch={apiFetch} source={{kind:'fabric',id:fabric.id,label:fabric.fabricNo}} onClose={onClose}/>;
}

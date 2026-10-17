export type ApprovedV2Page='patterns'|'pattern-editor'|'fabrics'|'products'|'product-editor'|'fabric-import'|'document-selector';
export const approvedV2Pages:ReadonlyArray<{id:ApprovedV2Page;label:string}>=Object.freeze([
 {id:'patterns',label:'花型库列表'},
 {id:'pattern-editor',label:'编辑花型及配色'},
 {id:'fabrics',label:'面料库维护'},
 {id:'products',label:'产品库列表'},
 {id:'product-editor',label:'新增及编辑产品'},
 {id:'fabric-import',label:'面料 XLSX 导入'},
 {id:'document-selector',label:'三种单据共用选品'}
]);

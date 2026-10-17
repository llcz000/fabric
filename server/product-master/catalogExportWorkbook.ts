import ExcelJS from 'exceljs';
import type {PatternMasterPageItem} from './patternCatalog';
import type {FabricCatalogItem} from './fabricCatalog';
import type {CatalogProduct} from './productSearch';
export type CatalogExportKind='patterns'|'fabrics'|'products';
export type CatalogExportItem=PatternMasterPageItem|FabricCatalogItem|CatalogProduct;
export const catalogExportHeaders={
 patterns:['花型','题材标签','颜色标签','配色版本'],
 fabrics:['品号','品名','成分','克重','门幅 / cm','备注','启用状态','关联产品'],
 products:['货号','品名','成分','克重','门幅 / cm','图片数量','备注','启用状态']
} as const;
const status=(active:boolean)=>active?'已启用':'已停用';
const weight=(value:number|null,unit:string|null)=>value===null?'':String(value)+(unit?' '+unit:'');
/** Only public list fields. Explicit mapping excludes IDs, images, keys and signed URLs. */
export async function buildCatalogWorkbook(kind:CatalogExportKind,items:readonly CatalogExportItem[]):Promise<Uint8Array>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet({patterns:'花型资料',fabrics:'面料资料',products:'产品资料'}[kind]);
 sheet.addRow([...catalogExportHeaders[kind]]);
 for(const item of items){
  let values:(string|number)[];
  if(kind==='patterns'){
   const row=item as PatternMasterPageItem;
   values=[row.masterNo+(row.isActive?'':'（已停用）'),row.topicTags.map(t=>t.name).join('、'),row.colorTags.map(t=>t.name).join('、'),
    row.versions.map(v=>v.patternNo+(v.isActive?'':'（已停用）')).join('、')];
  }else if(kind==='fabrics'){
   const row=item as FabricCatalogItem;
   values=[row.fabricNo,row.fabricName,row.composition??'',weight(row.weightValue,row.weightUnit),row.widthValue??'',row.remark??'',status(row.isActive),row.productCount];
  }else{
   const row=item as CatalogProduct;
   values=[row.productNo,row.fabricName,row.composition??'',weight(row.weightValue,row.weightUnit),row.widthCm??'',
    '大图 '+row.imageCounts.fabricDisplay+' · 细节 '+row.imageCounts.detail+' · 效果 '+row.imageCounts.aiEffect,row.remark,
    status(row.isActive)+(row.isAvailableForSampling?'':' / 暂不供样')];
  }
  sheet.addRow(values);
 }
 sheet.columns.forEach((column,index)=>{column.width=index===0?28:24;column.numFmt='@';});
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
 return new Uint8Array(await workbook.xlsx.writeBuffer());
}

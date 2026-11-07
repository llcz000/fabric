import type {CatalogProduct} from '../../../src/components/product-master-v2/catalogModel';
let failed=false,imageFailed=false;
export const relatedImageId=(masterId:string)=>'a1111111-1111-4111-8111-'+masterId.padStart(12,'0');
export async function relatedProductImagesPreview(init?:RequestInit):Promise<Response>{
 if(location.search.includes('linkedImageError')&&!imageFailed){imageFailed=true;return new Response('',{status:503});}
 const requests=JSON.parse(String(init?.body)).requests;
 return Response.json({results:requests.map((r:{assetId:string;variant:string})=>({...r,url:'https://fabric-related-fixture.invalid/'+r.assetId+'.svg'}))});
}
export async function relatedProductsPreview(url:URL,init?:RequestInit):Promise<Response>{
 if(location.search.includes('linkedDelay'))await new Promise(resolve=>setTimeout(resolve,400));
 if(location.search.includes('linkedError')&&!failed){failed=true;return new Response('',{status:503});}
 const pattern=url.searchParams.get('masterId');
 const fabric=url.searchParams.get('fabricId');
 let total=pattern?(pattern==='76'?21:0):fabric==='1'?5:fabric==='2'?2:0;
 const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);
 let items:CatalogProduct[]=Array.from({length:total},(_,i)=>{
  const masterId=pattern||String(76-i),masterNo='G'+masterId.padStart(4,'0');
  const fabricId=fabric||String(i+1),fabricNo=fabricId==='1'?'F018':fabricId==='2'?'F032':'F'+fabricId.padStart(3,'0');
  return {id:String(i+1),productNo:masterNo+'-1-'+fabricNo,masterId,masterNo,colorwayNo:1,
   patternColorwayId:String(Number(masterId)*100+1),fabricId,fabricNo,
   fabricName:fabricId==='2'?'高密棉麻':'轻薄印花雪纺',composition:fabricId==='2'?'棉 65% / 亚麻 35%':'聚酯纤维 100%',
   weightValue:fabricId==='2'?16.5:80,weightUnit:fabricId==='2'?'mm':'gsm',widthCm:fabricId==='2'?148:145,
   fabricRemark:'适合裙装、衬衫',remark:'这是产品备注，不应充当面料备注',
   isActive:true,isAvailableForSampling:true,masterActive:true,colorwayActive:true,fabricActive:true,isSelectable:true,
   rowVersion:'1',patternImageAssetId:location.search.includes('linkedImages=1')&&i!==4?relatedImageId(masterId):null,topicTags:[],colorTags:[],
   imageCounts:{fabricDisplay:0,detail:0,aiEffect:0},totalImages:0};
 });
 if(location.search.includes('sorting=1')){
  const template=items[0];
  const numbers=[8,15,100,...Array.from({length:35},(_,i)=>i+1).filter(n=>n!==8&&n!==15)];
  items=numbers.flatMap((number,index)=>[2,10].flatMap((colorwayNo,colorIndex)=>['F999','F001'].map((fabricNo,fabricIndex)=>{
   const masterNo='G'+number,id=String(index*4+colorIndex*2+fabricIndex+1);
   return {...template,id,masterId:String(number),masterNo,colorwayNo,fabricId:String(fabricIndex+1),fabricNo,
    patternColorwayId:String(number*100+colorwayNo),productNo:masterNo+'-'+colorwayNo+'-'+fabricNo};
  })));
  const query=(url.searchParams.get('productNo')??'').toLowerCase();
  items=items.filter(item=>item.productNo.toLowerCase().includes(query));total=items.length;
 }
 const sort=url.searchParams.get('sort');
 if(sort==='numberAsc'||sort==='numberDesc'){
  const direction=sort==='numberAsc'?1:-1;
  items.sort((a,b)=>direction*(Number(a.masterNo.slice(1))-Number(b.masterNo.slice(1))||a.colorwayNo-b.colorwayNo||Number(a.id)-Number(b.id)));
 }
 if(location.search.includes('linkedMismatch')&&items[0])items[0].masterId='999';
 return Response.json({items:items.slice(offset,offset+limit),total,limit,offset});
}

import type {CatalogProduct} from '../../../src/components/product-master-v2/catalogModel';
let failed=false;
export async function relatedProductsPreview(url:URL,init?:RequestInit):Promise<Response>{
 if(location.search.includes('linkedDelay'))await new Promise(resolve=>setTimeout(resolve,400));
 if(location.search.includes('linkedError')&&!failed){failed=true;return new Response('',{status:503});}
 const pattern=url.searchParams.get('masterId');
 const fabric=url.searchParams.get('fabricId');
 const total=pattern?(pattern==='76'?21:0):fabric==='1'?5:fabric==='2'?2:0;
 const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);
 const items:CatalogProduct[]=Array.from({length:total},(_,i)=>{
  const masterId=pattern||String(76-i),masterNo='G'+masterId.padStart(4,'0');
  const fabricId=fabric||String(i+1),fabricNo=fabricId==='1'?'F018':fabricId==='2'?'F032':'F'+fabricId.padStart(3,'0');
  return {id:String(i+1),productNo:masterNo+'-1-'+fabricNo,masterId,masterNo,colorwayNo:1,
   patternColorwayId:String(Number(masterId)*100+1),fabricId,fabricNo,
   fabricName:fabricId==='2'?'高密棉麻':'轻薄印花雪纺',composition:fabricId==='2'?'棉 65% / 亚麻 35%':'聚酯纤维 100%',
   weightValue:fabricId==='2'?16.5:80,weightUnit:fabricId==='2'?'mm':'gsm',widthCm:fabricId==='2'?148:145,
   fabricRemark:'适合裙装、衬衫',remark:'这是产品备注，不应充当面料备注',
   isActive:true,isAvailableForSampling:true,masterActive:true,colorwayActive:true,fabricActive:true,isSelectable:true,
   rowVersion:'1',patternImageAssetId:null,topicTags:[],colorTags:[],
   imageCounts:{fabricDisplay:0,detail:0,aiEffect:0},totalImages:0};
 });
 if(location.search.includes('linkedMismatch')&&items[0])items[0].masterId='999';
 return Response.json({items:items.slice(offset,offset+limit),total,limit,offset});
}

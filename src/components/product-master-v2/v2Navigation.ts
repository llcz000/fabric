export type V2View='stats'|'documents'|'create'|'pattern'|'fabric'|'products'|'cards'|'samples'|'settings'|'members'|'preview'|'inventory';
const views:V2View[]=['stats','documents','create','pattern','fabric','products','cards','samples','settings','members','preview','inventory'];
export function readV2Route(hash:string){
 const [path,query='']=hash.replace(/^#\/?/,'').split('?'),params=new URLSearchParams(query);
 const view=views.includes(path as V2View)?path as V2View:'stats';
 return {view,productName:params.get('productName')??'',previewId:/^[1-9]\d{0,19}$/.test(params.get('id')??'')?params.get('id')!:'',params};
}
export function v2Route(view:V2View,params:Record<string,string>={}){
 const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==''));
 return '#/'+view+(query.size?'?'+query.toString():'');
}
export const V2_ROUTE_INDEX='__fabricV2RouteIndex';

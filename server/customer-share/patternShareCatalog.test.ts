import test from 'node:test';import assert from 'node:assert/strict';
import {loadPatternShareCatalog} from './patternShareCatalog';import {projectPublicPattern} from './publicPatternProjection';
const key=Buffer.alloc(32,7),asset='11111111-1111-4111-8111-111111111111';
function fixture(){const data={colors:[{id:'8',colorway_no:1,pattern_image_asset_id:asset,is_active:1}],products:[{id:'18',colorway_id:'8',is_active:1,fabric_is_active:1,fabric_no:'F018',fabric_name:'真丝',composition:null,weight_value:'18',weight_unit:'mm',width_value:'145'}],images:[{colorway_id:'8',product_id:null,asset_id:asset,role:'design',asset_status:'ready',variant:'display',byte_size:100,mime:'image/webp'},{colorway_id:'8',product_id:'18',asset_id:asset,role:'fabric_display',asset_status:'ready',variant:'display',byte_size:100,mime:'image/webp'}]};return {data,db:{async query(sql:string):Promise<[unknown,unknown]>{if(sql.includes('SELECT master_no'))return [[{master_no:'1234',is_active:1}],[]];if(sql.includes('AS public_role'))return [data.images,[]];if(sql.includes('AS colorway_id'))return [data.products,[]];if(sql.includes('FROM pattern_colorways'))return [data.colors,[]];throw Error('Unexpected SQL');}}};}
test('current public catalog produces opaque display refs and whitelist specs without IDs, price or originals',async()=>{
 const {db}=fixture(),loaded=await loadPatternShareCatalog(db,'4',key);assert(loaded);const publicValue=projectPublicPattern(loaded.candidate)!;
 assert.equal(publicValue.colorways[0].fabrics[0].weightUnit,'mm');assert.equal(publicValue.colorways[0].fabrics[0].composition,null);
 const raw=JSON.stringify(publicValue);assert(!raw.includes(asset));assert(!raw.includes('asset_id'));assert(!raw.includes('original'));assert(!raw.includes('price'));assert.equal(loaded.previews.size,2);assert([...loaded.previews.keys()].every(x=>/^display:[A-Za-z0-9_-]{43}$/.test(x)));
});
test('inactive parents/products and replaced associations never keep an old preview reference',async()=>{
 const {db,data}=fixture(),first=await loadPatternShareCatalog(db,'4',key);assert(first);const old=[...first.previews.keys()][1];data.products[0].is_active=0;
 const next=await loadPatternShareCatalog(db,'4',key);assert(next);assert(!next.previews.has(old));assert.equal(projectPublicPattern(next.candidate)!.colorways[0].fabrics.length,0);
 data.colors[0].is_active=0;assert.equal(projectPublicPattern((await loadPatternShareCatalog(db,'4',key))!.candidate)!.colorways.length,0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {searchPatternCatalog,parsePatternCatalogQuery} from './patternCatalog';
import {searchProductCatalog,parseProductSearchQuery} from './productSearch';

test('pattern product totals cover every colorway independently of visible colorway filtering',async()=>{
 const calls:string[]=[];
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  calls.push(sql);
  if(sql.startsWith('SELECT COUNT(*) AS total'))return [[{total:2}],[]];
  if(sql.startsWith('SELECT COUNT(*) AS colorway_total'))return [[{colorway_total:1}],[]];
  if(sql.includes('FROM pattern_masters m'))return [[
   {id:'1',master_no:'G0001',is_active:1,next_colorway_no:3,product_count:'21'},
   {id:'2',master_no:'G0002',is_active:1,next_colorway_no:1,product_count:'0'}
  ],[]];
  return [[],[]];
 }};
 const page=await searchPatternCatalog(db,parsePatternCatalogQuery({colorwayNo:'2'}));
 assert.equal(page.items[0].productCount,21);
 assert.equal(page.items[1].productCount,0);
 const select=calls.find(sql=>sql.includes('LIMIT ? OFFSET ?'))!;
 assert.match(select,/COUNT\(\*\).*v2_products.*pattern_colorways.*master_id=m.id/s);
 // The count is independent of the requested colorway and active-state filters.
 const aggregate=select.slice(select.indexOf('(SELECT'),select.indexOf('AS product_count'));
 assert(!aggregate.includes('colorway_no=?'));
 assert(!aggregate.includes('is_active'));
});

test('linked product details include the current fabric remark separately from product remark',async()=>{
 const calls:string[]=[];
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  calls.push(sql);
  if(sql.startsWith('SELECT COUNT(*)'))return [[{total:1}],[]];
  if(sql.includes('ORDER BY p.product_no'))return [[{
   id:'1',pattern_colorway_id:'2',fabric_id:'3',master_id:'4',master_no:'G0004',colorway_no:2,
   product_no:'G0004-2-F003',fabric_no:'F003',fabric_name:'轻薄雪纺',composition:'涤纶 100%',
   weight_value:'80',weight_unit:'gsm',width_value:'145',fabric_remark:'透感面料，适合连衣裙',
   remark:'产品内部备注',is_active:1,is_available_for_sampling:1,master_active:1,colorway_active:1,
   fabric_active:1,row_version:'1',pattern_image_asset_id:null
  }],[]];
  return [[],[]];
 }};
 const page=await searchProductCatalog(db,parseProductSearchQuery({masterId:'4',status:'all',limit:'20',offset:'0'}));
 assert.equal(page.items[0].fabricRemark,'透感面料，适合连衣裙');
 assert.equal(page.items[0].remark,'产品内部备注');
 assert(calls.some(sql=>sql.includes('f.remark AS fabric_remark')));
});

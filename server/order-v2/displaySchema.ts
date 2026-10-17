/** Optional header display snapshot is additive and never backfills historical orders. */
export const getV2DocumentDisplaySchemaSql=():readonly string[]=>[
 "ALTER TABLE orders ADD COLUMN v2_display_snapshot JSON NULL"
];
export async function inspectV2DocumentDisplaySchema(
 db:{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
):Promise<'legacy'|'expanded'>{
 const [data]=await db.query(
  "SELECT COLUMN_NAME,DATA_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='v2_display_snapshot'"
 );
 if(!Array.isArray(data))throw Error('Cannot inspect V2 order display metadata');
 if(data.length===0)return 'legacy';
 if(data.length!==1||(data[0] as Record<string,unknown>).DATA_TYPE!=='json'||
  (data[0] as Record<string,unknown>).IS_NULLABLE!=='YES')
  throw Error('V2 order display schema drift');
 return 'expanded';
}

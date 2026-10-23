import type { V2SchemaConnection } from './schema';

export const V2_SCHEMA_VERSION = 2 as const;

/**
 * P1-C-2 read-only schema attestation for the highest-risk V2 identity,
 * uniqueness, reference and optional-unit invariants. Never auto-repair drift.
 *
 * MySQL INFORMATION_SCHEMA results are used, not the presence of IF NOT EXISTS
 * statements or the same-named index alone. No legacy order/product SQL.
 */
interface ColumnSpec {type:string; nullable:'YES'|'NO'}
interface IndexSpec {columns:readonly string[]}
interface ForeignKeySpec {column:string; refTable:string; refColumn:string; deleteRule:'RESTRICT'|'CASCADE'}
interface TableSpec {
  cols:Readonly<Record<string,ColumnSpec>>;
  unique:Readonly<Record<string,IndexSpec>>;
  fks?:Readonly<Record<string,ForeignKeySpec>>;
  checks?:readonly string[];
}
const col = (type:string, nullable:'YES'|'NO'='NO'):ColumnSpec=>({type,nullable});
const contract:Readonly<Record<string,TableSpec>>={
  pattern_masters:{
    cols:{id:col('bigint unsigned'),master_no:col('varchar(64)'),next_colorway_no:col('bigint unsigned'),is_active:col('tinyint(1)')},
    unique:{PRIMARY:{columns:['id']},uq_v2_master_no:{columns:['master_no']}},
    checks:['ck_v2_next_colorway_positive','ck_v2_master_no','ck_v2_master_active']
  },
  pattern_colorways:{
    cols:{id:col('bigint unsigned'),master_id:col('bigint unsigned'),colorway_no:col('int unsigned'),pattern_image_asset_id:col('varchar(36)','YES')},
    unique:{PRIMARY:{columns:['id']},uq_v2_master_colorway:{columns:['master_id','colorway_no']}},
    fks:{
      fk_v2_colorway_master:{column:'master_id',refTable:'pattern_masters',refColumn:'id',deleteRule:'RESTRICT'},
      fk_v2_colorway_image:{column:'pattern_image_asset_id',refTable:'image_assets',refColumn:'id',deleteRule:'RESTRICT'}
    },
    checks:['ck_v2_colorway_positive']
  },
  v2_fabrics:{
    cols:{id:col('bigint unsigned'),fabric_no:col('varchar(64)'),fabric_name:col('varchar(255)'),weight_value:col('decimal(12,3)','YES'),weight_unit:col("enum('gsm','mm')",'YES'),width_value:col('decimal(12,2)','YES')},
    unique:{PRIMARY:{columns:['id']},uq_v2_fabric_no:{columns:['fabric_no']}},
    checks:['ck_v2_fabric_weight','ck_v2_fabric_width']
  },
  shared_tags:{
    cols:{id:col('bigint unsigned'),dimension:col("enum('topic','color')"),normalized_name:col('varchar(64)')},
    unique:{PRIMARY:{columns:['id']},uq_v2_dimension_normalized:{columns:['dimension','normalized_name']}}
  },
  pattern_master_tag_links:{
    cols:{master_id:col('bigint unsigned'),tag_id:col('bigint unsigned')},
    unique:{PRIMARY:{columns:['master_id','tag_id']}},
    fks:{
      fk_v2_mtags_master:{column:'master_id',refTable:'pattern_masters',refColumn:'id',deleteRule:'CASCADE'},
      fk_v2_mtags_tag:{column:'tag_id',refTable:'shared_tags',refColumn:'id',deleteRule:'RESTRICT'}
    }
  },
  pattern_colorway_tag_links:{
    cols:{colorway_id:col('bigint unsigned'),tag_id:col('bigint unsigned')},
    unique:{PRIMARY:{columns:['colorway_id','tag_id']}},
    fks:{
      fk_v2_ctags_colorway:{column:'colorway_id',refTable:'pattern_colorways',refColumn:'id',deleteRule:'CASCADE'},
      fk_v2_ctags_tag:{column:'tag_id',refTable:'shared_tags',refColumn:'id',deleteRule:'RESTRICT'}
    }
  },
  v2_products:{
    cols:{id:col('bigint unsigned'),pattern_colorway_id:col('bigint unsigned'),fabric_id:col('bigint unsigned'),product_no:col('varchar(160)'),row_version:col('bigint unsigned'),is_available_for_sampling:col('tinyint(1)')},
    unique:{PRIMARY:{columns:['id']},uq_v2_colorway_fabric:{columns:['pattern_colorway_id','fabric_id']},uq_v2_product_no:{columns:['product_no']}},
    fks:{
      fk_v2_products_colorway:{column:'pattern_colorway_id',refTable:'pattern_colorways',refColumn:'id',deleteRule:'RESTRICT'},
      fk_v2_products_fabric:{column:'fabric_id',refTable:'v2_fabrics',refColumn:'id',deleteRule:'RESTRICT'}
    },
    checks:['ck_v2_product_sampling']
  },
  v2_product_image_assets:{
    cols:{id:col('bigint unsigned'),product_id:col('bigint unsigned'),asset_id:col('varchar(36)'),role:col("enum('fabric_display','detail','ai_effect')"),active_asset_id:col('varchar(36)','YES')},
    unique:{PRIMARY:{columns:['id']},uq_v2_product_active_asset:{columns:['product_id','active_asset_id']}},
    fks:{
      fk_v2_product_image_product:{column:'product_id',refTable:'v2_products',refColumn:'id',deleteRule:'RESTRICT'},
      fk_v2_product_image_asset:{column:'asset_id',refTable:'image_assets',refColumn:'id',deleteRule:'RESTRICT'}
    }
  }
};

type SqlRow=Record<string,unknown>;
function getRows(rows:unknown,kind:string):SqlRow[] {
  if (!Array.isArray(rows)) throw Error('MySQL metadata '+kind+' unavailable');
  if (rows.some(row=>row===null || typeof row!=='object')) throw Error('Invalid metadata '+kind);
  return rows as SqlRow[];
}
function norm(s:unknown):string {return String(s??'').toLowerCase().replace(/\s+/g,'').replace(/\`/g,'').trim();}
function readIndex(rows:SqlRow[],name:string):{unique:boolean;columns:string[]}|undefined {
  const hits=rows.filter(row=>String(row.INDEX_NAME)===name)
    .sort((a,b)=>Number(a.SEQ_IN_INDEX)-Number(b.SEQ_IN_INDEX));
  if (!hits.length) return undefined;
  return {unique:hits.every(row=>Number(row.NON_UNIQUE)===0),columns:hits.map(row=>String(row.COLUMN_NAME))};
}
export async function verifyV2SchemaContract(connection:V2SchemaConnection):Promise<void>{
  for (const [table,spec] of Object.entries(contract)) {
    const [columnRows]=await connection.query(
      'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
      [table]);
    const columns=getRows(columnRows,'columns');
    for(const [name,expected] of Object.entries(spec.cols)) {
      const actual=columns.find(row=>row.COLUMN_NAME===name);
      if(!actual) throw Error(`V2 schema drift ${table}.${name}: missing column`);
      if(norm(actual.COLUMN_TYPE)!==norm(expected.type))
        throw Error(`V2 schema drift ${table}.${name}: type mismatch (${String(actual.COLUMN_TYPE)})`);
      if(String(actual.IS_NULLABLE)!==expected.nullable)
        throw Error(`V2 schema drift ${table}.${name}: nullability mismatch`);
    }
    const [indexRows]=await connection.query(
      'SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
      [table]);
    const indexes=getRows(indexRows,'indexes');
    for(const [index,specification] of Object.entries(spec.unique)) {
      const actual=readIndex(indexes,index);
      // The registered reuse migration scopes the same unique index to live rows.
      const activeMasterNumber=table==='pattern_masters'&&index==='uq_v2_master_no'&&
        actual?.columns.length===1&&actual.columns[0]==='active_master_no'&&
        columns.some(c=>c.COLUMN_NAME==='active_master_no'&&norm(c.COLUMN_TYPE)==='varchar(64)'&&c.IS_NULLABLE==='YES');
      const expectedColumns=activeMasterNumber?['active_master_no']:specification.columns;
      if(!actual || !actual.unique || JSON.stringify(actual.columns)!==JSON.stringify(expectedColumns))
        throw Error(`V2 schema drift ${table}.${index}: missing, nonunique or wrong order`);
    }
    const [foreignRows]=await connection.query(
      'SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL',
      [table]);
    const fks=getRows(foreignRows,'foreign keys');
    for(const [name,expected] of Object.entries(spec.fks??{})) {
      const actual=fks.find(row=>row.CONSTRAINT_NAME===name);
      if (!actual || String(actual.COLUMN_NAME)!==expected.column ||
        String(actual.REFERENCED_TABLE_NAME)!==expected.refTable ||
        String(actual.REFERENCED_COLUMN_NAME)!==expected.refColumn ||
        String(actual.DELETE_RULE).toUpperCase()!==expected.deleteRule) {
        throw Error(`V2 schema drift ${table}.${name}: foreign key mismatch`);
      }
    }
    const [checkRows]=await connection.query(
      "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='CHECK'",
      [table]);
    const checks=new Set(getRows(checkRows,'CHECK constraints').map(row=>String(row.CONSTRAINT_NAME)));
    for(const name of spec.checks??[]) {
      if(!checks.has(name)) throw Error(`V2 schema drift ${table}.${name}: CHECK missing`);
    }
  }
}

export interface SchemaUpgradeStep {version:2;description:string;sql:string}
const v1to2:SchemaUpgradeStep={
  version:2,description:'add monotonic colorway counter',
  sql:'ALTER TABLE pattern_masters ADD COLUMN next_colorway_no BIGINT UNSIGNED NOT NULL DEFAULT 1, ADD CONSTRAINT ck_v2_next_colorway_positive CHECK (next_colorway_no > 0)'
};
/**
 * Safe, deterministic *plan*, not an executor. MySQL ALTER implicitly commits.
 * Never silently migrate unknown schema or any populated colorway dataset.
 * A future migration runner needs a separately gated version ledger/lock,
 * table backup and verification before executing this statement.
 */
export function planV2SchemaUpgrade(input:{currentVersion:number;existingRows:number}):readonly SchemaUpgradeStep[]{
  if(input.currentVersion===V2_SCHEMA_VERSION) return [];
  if(input.currentVersion!==1) throw Error('Unknown/unsupported V2 schema version');
  if(!Number.isSafeInteger(input.existingRows) || input.existingRows!==0) throw Error('Cannot upgrade nonempty V2 schema data automatically');
  return [v1to2];
}

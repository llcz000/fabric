import test from 'node:test';
import assert from 'node:assert/strict';
import {getV2DocumentDisplaySchemaSql,inspectV2DocumentDisplaySchema} from './displaySchema';
test('P6 header snapshot is strictly nullable additive JSON, no historical backfill',()=>{
 const sql=getV2DocumentDisplaySchemaSql().join(';');
 assert.match(sql,/ADD COLUMN v2_display_snapshot JSON NULL/i);
 assert.doesNotMatch(sql,/UPDATE orders|DELETE FROM|DROP |DEFAULT\s*\{/i);
});
test('P6 header schema read-only detection rejects wrong JSON type and NULL drift',async()=>{
 const query=(cols:Record<string,unknown>[])=>({query:async()=>[cols,[]] as [unknown,unknown]});
 assert.equal(await inspectV2DocumentDisplaySchema(query([])),'legacy');
 assert.equal(await inspectV2DocumentDisplaySchema(query([{COLUMN_NAME:'v2_display_snapshot',DATA_TYPE:'json',IS_NULLABLE:'YES'}])),'expanded');
 await assert.rejects(inspectV2DocumentDisplaySchema(query([{COLUMN_NAME:'v2_display_snapshot',DATA_TYPE:'text',IS_NULLABLE:'YES'}])),/drift/);
 await assert.rejects(inspectV2DocumentDisplaySchema(query([{COLUMN_NAME:'v2_display_snapshot',DATA_TYPE:'json',IS_NULLABLE:'NO'}])),/drift/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readV2Document} from './documents';
const actor={role:'admin',userId:'1',sessionId:'1'} as any;
function database(line:Record<string,unknown>){return {async query(sql:string):Promise<[unknown,unknown]>{return [sql.includes('FROM orders')?[{id:41,template_type:'bulk',created_by_user_id:null}]:[{id:130,piece_meters:'[47.8,27.2,35.8,53.6,null,null]',...line}],[]];}};}
test('read legacy null-padded roll slots without rewriting or weakening new V2 roll input',async()=>{
 const db=database({v2_source_kind:null,v2_product_snapshot:null});
 assert.deepEqual((await readV2Document(db,actor,'41')).items[0].pieceMeters,[47.8,27.2,35.8,53.6]);
 await assert.rejects(()=>readV2Document(database({v2_source_kind:'catalog',v2_product_snapshot:'{}'}),actor,'41'));
 await assert.rejects(()=>readV2Document(database({piece_meters:'[47.8,"bad",null]'}),actor,'41'));
});

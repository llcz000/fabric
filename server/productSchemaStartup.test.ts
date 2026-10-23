import assert from 'node:assert/strict';
import test from 'node:test';
import {createV2ProductionRouter} from './product-master/v2ProductionRuntime';

test('V2 startup refuses incomplete schema without creating or rewriting historical data',async()=>{
 const calls:string[]=[];
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 const pool={async getConnection(){return {
  async query(sql:string){calls.push(sql);return [sql.includes('DATABASE() AS database_name')?[{database_name:target.database,server_uuid:target.serverUuid}]:[],[]] as [unknown,unknown];},
  async beginTransaction(){throw Error('Unexpected write transaction');},async commit(){},async rollback(){},release(){}
 };}};
 await assert.rejects(createV2ProductionRouter(pool,target));
 assert(calls.length>1,'schema metadata must actually be inspected');
 assert(calls.every(s=>/^\s*SELECT\b/i.test(s)),'startup must be read-only; migrations are separate');
});

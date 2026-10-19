import assert from 'node:assert/strict';
import test from 'node:test';
import {bootstrapV2Administrator} from './bootstrapAdministrator';
test('bootstrap never replaces an existing account or password',async()=>{
 const queries:string[]=[];const db={async query(sql:string){queries.push(sql);return [sql.includes('COUNT')?[{total:1}]:[{acquired:1}],[]] as [unknown,unknown];}};
 await assert.rejects(bootstrapV2Administrator(db,'Long-test-password-2026'),/already initialized/);assert(!queries.some(s=>/INSERT|UPDATE|DELETE/.test(s)));
});
test('bootstrap inserts only one hashed administrator and releases its lock',async()=>{
 const calls:{sql:string;args:unknown[]}[]=[];const db={async query(sql:string,args:unknown[]=[]){calls.push({sql,args});return [sql.includes('COUNT')?[{total:0}]:[{acquired:1}],[]] as [unknown,unknown];}};
 await bootstrapV2Administrator(db,'Long-test-password-2026');const insert=calls.find(x=>x.sql.startsWith('INSERT'))!;assert(insert);assert(!insert.args.includes('Long-test-password-2026'));assert.match(calls.at(-1)!.sql,/RELEASE_LOCK/);
});

/** Fixed, disposable B2-5 acceptance-test sandbox. Never production. */
export const B25_SANDBOX_NAME='fabric_v2_test_20261014_b25isolated';
export interface B25GuardDatabase {
 query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
const MYSQL_UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function requireB25ExpectedServerUuid(input:unknown):string {
 if(typeof input!=='string'||!MYSQL_UUID.test(input))
  throw Error('B2-5 explicit expected MySQL server UUID required');
 return input.toLowerCase();
}
function matchServerUuid(actual:unknown,expected:string):void {
 if(typeof actual!=='string'||!MYSQL_UUID.test(actual)||actual.toLowerCase()!==expected)
  throw Error('B2-5 MySQL server UUID mismatch; refusing sandbox operations');
}
/** The pooled connection may not silently drift to another MySQL server/schema. */
export async function assertB25ConnectedSandbox(db:B25GuardDatabase,expectedUuid:string):Promise<void>{
 const pinned=requireB25ExpectedServerUuid(expectedUuid);
 const [rows]=await db.query('SELECT DATABASE() AS selected_database, @@server_uuid AS server_uuid');
 if(!Array.isArray(rows)||rows.length!==1||!rows[0]||typeof rows[0]!=='object')
  throw Error('B2-5 pooled sandbox identity unavailable');
 const {selected_database,server_uuid}=rows[0] as Record<string,unknown>;
 if(selected_database!==B25_SANDBOX_NAME)throw Error('B2-5 pooled sandbox identity mismatch');
 matchServerUuid(server_uuid,pinned);
}

/** Two SELECTs only; root connection must not have selected any business DB.
 * A separate explicitly approved runner may issue CREATE DATABASE afterwards.
 * Any existing name is occupied (even if it looks empty): never overwrite.
 */
export async function assertFreshB25SandboxTarget(db:B25GuardDatabase,ack:string,expectedUuid:string):Promise<string>{
 if(ack!=='I_ACKNOWLEDGE_B25_DISPOSABLE_TEST')
  throw Error('B2-5 explicit test-only acknowledgment required');
 const pinned=requireB25ExpectedServerUuid(expectedUuid);
 const [identity]=await db.query('SELECT DATABASE() AS selected_database, VERSION() AS mysql_version, @@server_uuid AS server_uuid');
 if(!Array.isArray(identity)||identity.length!==1||!identity[0]||
    typeof identity[0]!=='object')throw Error('B2-5 remote database identity unavailable');
 const {selected_database,mysql_version,server_uuid}=identity[0] as Record<string,unknown>;
 if(selected_database!==null||typeof mysql_version!=='string'||!/^8\./.test(mysql_version))
  throw Error('B2-5 target identity must be a root connection to MySQL 8');
 matchServerUuid(server_uuid,pinned);
 const [existing]=await db.query(
  'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?',[B25_SANDBOX_NAME]);
 if(!Array.isArray(existing))throw Error('B2-5 sandbox existence check unavailable');
 if(existing.length!==0)throw Error('B2-5 sandbox already exists; stop without touching existing data');
 return B25_SANDBOX_NAME;
}

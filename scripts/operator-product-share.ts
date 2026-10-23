import mysql from 'mysql2/promise';
import {migrateProductShareLinks} from '../server/customer-share/productShareMigration';
async function main(){
 const [database,serverUuid,backupSha,confirmation]=process.argv.slice(2);
 if(!/^[A-Za-z0-9_]{1,64}$/.test(database??'')||serverUuid!=='a937ff09-72b6-11f1-b04e-52540034488b')throw Error('Explicit verified target required');
 const pool=mysql.createPool({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,connectionLimit:1});
 try{console.log(JSON.stringify(await migrateProductShareLinks(pool,{database,serverUuid},backupSha,confirmation)));}finally{await pool.end();}
}
main().catch(()=>{console.error('Product sharing migration stopped; production rollback must preserve all existing rows');process.exitCode=1;});

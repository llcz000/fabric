import mysql from 'mysql2/promise';
import {resolveV2ProductionTarget,createPinnedV2Database} from '../server/product-master/v2ProductionTarget';
import {verifyV2ProductionSchema} from '../server/product-master/v2ProductionMigration';
import {bootstrapV2Administrator} from '../server/access/bootstrapAdministrator';
async function main(){
 const target=resolveV2ProductionTarget(process.env);
 if(!target||process.env.FABRIC_V2_BOOTSTRAP_ADMIN!=='CREATE_INITIAL_ADMIN_ONLY'||!process.env.ADMIN_PASSWORD)throw Error('Explicit initial administrator setup required');
 const pool=mysql.createPool({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:target.database,supportBigNumbers:true,bigNumberStrings:true});
 try{const db=createPinnedV2Database(pool,target);await verifyV2ProductionSchema(db,target.database);const connection=await db.getConnection();try{await bootstrapV2Administrator(connection,process.env.ADMIN_PASSWORD);}finally{connection.release();}console.log(JSON.stringify({database:target.database,initialAdministrator:'admin',passwordSource:'existing protected ADMIN_PASSWORD',existingAccountsReplaced:false}));}
 finally{await pool.end();}
}
main().catch(error=>{
 const code=error&&typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'UNAVAILABLE';
 const message=error instanceof Error&&/^(Explicit|V2 accounts|Administrator bootstrap|Password length|V2 production configuration)/.test(error.message)?error.message:'Initial V2 administrator setup refused';
 console.error(message+' ['+code+']');process.exitCode=1;
});

import {createV2RecoveryProxy} from '../server/product-master/v2RecoveryProxy';
async function main(){
 if(process.env.FABRIC_V2_RECOVERY!=='READ_ONLY_V2'||process.env.HOST&&process.env.HOST!=='127.0.0.1')throw Error('Explicit loopback recovery configuration required');
 const port=Number(process.env.PORT??3000);if(!Number.isInteger(port)||port<1024||port>65535||!process.env.FABRIC_V2_RECOVERY_UPSTREAM)throw Error('Invalid recovery configuration');
 const app=await createV2RecoveryProxy(process.env.FABRIC_V2_RECOVERY_UPSTREAM),server=app.listen(port,'127.0.0.1');
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{server.close();server.closeAllConnections();});
 console.log('[V2] Read-only recovery proxy ready');
}
main().catch(()=>{console.error('V2 recovery startup refused');process.exitCode=1;});

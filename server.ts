import 'dotenv/config';
import {resolveV2ProductionTarget} from './server/product-master/v2ProductionTarget';
import {startV2ProductionServer} from './server/product-master/v2ProductionRuntime';

/** Only the pinned V2 runtime may serve the application. No legacy or JSON fallback. */
async function startServer(){
 if(resolveV2ProductionTarget(process.env)){
  await startV2ProductionServer();
  return;
 }
 throw Error('V2 production configuration required; legacy runtime has been retired');
}

startServer().catch(()=>{
 console.error('[Server] V2 startup refused; verify configuration, database identity and schema');
 process.exitCode=1;
});

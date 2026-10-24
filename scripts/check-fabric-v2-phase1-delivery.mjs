/** Fabric V2 P0-P7 release readiness checklist, local read-only evidence gate.
 *  - Neither this report nor submitted QA evidence authorizes deployment.
 *  - Never reads database credentials, connects to remote services, or changes files.
 *  - Literal source markers are preflight hints, not runtime integration proof.
 *  - External gate evidence is independently reviewed; CLI validates paths.
 *
 * Usage: node scripts/check-fabric-v2-phase1-delivery.mjs --status
 *       node scripts/check-fabric-v2-phase1-delivery.mjs --evidence docs/operations/phase1-evidence.json
 */
import {readFileSync,existsSync,statSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

import ts from 'typescript';
function staticSourceMounts(server,app,productionRuntime,productionHttp){
 const source=ts.createSourceFile('server.ts',String(server??''),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const ui=ts.createSourceFile('App.tsx',String(app??''),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const routerVars=new Set();
 let backend=false,frontend=false;
 function visitBackend(node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)){
   const init=node.initializer;
   const actual=init&&ts.isAwaitExpression(init)?init.expression:init;
   if(actual&&ts.isCallExpression(actual)&&ts.isIdentifier(actual.expression)&&
     actual.expression.text==='createV2CatalogAssembly')routerVars.add(node.name.text);
  }
  ts.forEachChild(node,visitBackend);
 }
 visitBackend(source);
 function findMount(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
   node.expression.name.text==='use'&&node.arguments.length>=2&&
   ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/v2'&&
   ts.isIdentifier(node.arguments[1])&&routerVars.has(node.arguments[1].text))backend=true;
  ts.forEachChild(node,findMount);
 }
 findMount(source);
 if(!backend&&productionRuntime&&productionHttp){
  const parse=(name,value)=>ts.createSourceFile(name,String(value),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const runtime=parse('v2ProductionRuntime.ts',productionRuntime),http=parse('v2ProductionHttp.ts',productionHttp);
  const matches=(node,test)=>{if(test(node))return true;return ts.forEachChild(node,child=>matches(child,test)||undefined)===true;};
  const call=(node,name)=>ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===name;
  const imported=(file,name,module)=>file.statements.some(n=>ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text===module&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.some(e=>e.name.text===name&&(!e.propertyName||e.propertyName.text===name)));
  const fn=(file,name)=>file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)?.body;
  const start=fn(source,'startServer'),assemble=fn(runtime,'createV2ProductionRouter'),run=fn(runtime,'startV2ProductionServer'),compose=fn(http,'createV2ProductionHttpApp');
  const guarded=start&&matches(start,n=>ts.isIfStatement(n)&&call(n.expression,'resolveV2ProductionTarget')&&n.expression.arguments.length===1&&n.expression.arguments[0].getText(source)==='process.env'&&matches(n.thenStatement,c=>call(c,'startV2ProductionServer'))&&matches(n.thenStatement,c=>ts.isReturnStatement(c)));
  const pinned=name=>assemble&&matches(assemble,n=>ts.isVariableDeclaration(n)&&n.name.getText(runtime)===name&&n.initializer&&call(n.initializer,'createPinnedV2Database')&&n.initializer.arguments.map(a=>a.getText(runtime)).join(',')==='pool,target');
  const customerDatabase=pinned('baseDb')&&imported(runtime,'prepareCustomerRuntime','../customers/runtime')&&
   matches(assemble,n=>ts.isVariableDeclaration(n)&&n.name.getText(runtime)==='db'&&n.initializer?.getText(runtime)==='baseDb')&&
   matches(assemble,n=>ts.isVariableDeclaration(n)&&n.name.getText(runtime)==='customers'&&n.initializer&&ts.isAwaitExpression(n.initializer)&&call(n.initializer.expression,'prepareCustomerRuntime')&&n.initializer.expression.arguments.map(a=>a.getText(runtime)).join(',')==='baseDb,target')&&
   matches(assemble,n=>ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&n.left.getText(runtime)==='db'&&n.right.getText(runtime)==='customers.pool');
  const assembly=assemble&&(pinned('db')||customerDatabase)&&
   ['verifyV2ProductionSchema','verifyV2DocumentSupportSchema'].every(name=>matches(assemble,n=>ts.isAwaitExpression(n)&&call(n.expression,name)&&n.expression.arguments[0]?.getText(runtime)==='db'))&&
   matches(assemble,n=>ts.isVariableDeclaration(n)&&n.name.getText(runtime)==='routes'&&n.initializer&&call(n.initializer,'createV2BusinessRoutes')&&n.initializer.arguments.slice(0,2).every(a=>a.getText(runtime)==='db'));
  const launch=run&&matches(run,n=>ts.isAwaitExpression(n)&&call(n.expression,'createV2ProductionRouter'))&&matches(run,n=>call(n,'createV2ProductionHttpApp')&&n.arguments[0]?.getText(runtime)==='routes');
  const mount=compose&&matches(compose,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(http)==='app'&&n.expression.name.text==='use'&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='/api/v2'&&n.arguments[1].getText(http)==='routes');
  backend=Boolean(imported(source,'startV2ProductionServer','./server/product-master/v2ProductionRuntime')&&imported(source,'resolveV2ProductionTarget','./server/product-master/v2ProductionTarget')&&imported(runtime,'createV2ProductionHttpApp','./v2ProductionHttp')&&guarded&&assembly&&launch&&mount);
 }
 function findUi(node){
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&
   node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])&&
   /^\.\/components\/product-master-v2\/[a-zA-Z0-9_-]+$/.test(node.arguments[0].text))frontend=true;
  ts.forEachChild(node,findUi);
 }
 findUi(ui);
 return {backend,frontend};
}
export const PHASE1_EVIDENCE_GATES=Object.freeze([
 'P1_production_schema_and_migration',
 'P1_backup_restore_and_rollback',
 'P2_live_identity_roles_and_legacy_cutover',
 'P3_real_catalog_CRUD_media_COS',
 'P4_seven_pages_business_UI_acceptance',
 'P5_real_XLSX_import_and_rollback',
 'P6_old_and_new_three_document_roundtrip',
 'P7_full_E2E_auth_and_P95'
]);
const hints=Object.freeze({
 P1_production_schema_and_migration:'签收目标库版本、迁移锁、DDL/约束、历史保护；生产写入另行批准',
 P1_backup_restore_and_rollback:'出具可恢复备份、前滚/回退演练、上线回滚责任人',
 P2_live_identity_roles_and_legacy_cutover:'正式账号管理员/业务员实际授权与跨账号拒绝、旧接口切换',
 P3_real_catalog_CRUD_media_COS:'三库真实增删改查、文件授权上传/预览与COS回收',
 P4_seven_pages_business_UI_acceptance:'正式账号七页浏览器全流程、Stitch已批准改动复核及用户签收',
 P5_real_XLSX_import_and_rollback:'仅xlsx在目标库真实预览/提交/并发冲突/回滚',
 P6_old_and_new_three_document_roundtrip:'三单据保存回读/打印导出/旧历史/共享图片与库存保护',
 P7_full_E2E_auth_and_P95:'V2正式全链路安全、性能P95≤1s目标及部署回退演练'
});
const stripComments=v=>String(v??'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
const validProof=proof=>typeof proof==='string'&&proof.length>12&&proof.length<360&&/^docs\/(?:operations|product-master|retrospectives\/development)\/[\w.\-\u4e00-\u9fa5/]+\.md(?:#[\w.\-]+)?$/i.test(proof);
const validReviewer=name=>typeof name==='string'&&name.trim().length>=4&&name.length<=80;
/** Pure assessment. Reviewer claims are ONLY inputs: CLI additionally requires a real local referenced file. */
export function assessPhase1({server,app,productionRuntime,productionHttp,evidence={}}={}){
 const {backend,frontend}=staticSourceMounts(server,app,productionRuntime,productionHttp);
 const sourceGates={
  backendMount:{ok:backend,what:'正式server.ts装配受控V2路由/启用前置条件'},
  frontendMount:{ok:frontend,what:'正式src/App.tsx接入V2七页导航（静态证据）'}
 };
 const evidenceGates=PHASE1_EVIDENCE_GATES.map(id=>{
  const value=evidence&&typeof evidence==='object'?evidence[id]:undefined;
  const ok=Boolean(value&&value.status==='passed'&&validReviewer(value.reviewedBy)&&validProof(value.proof)&&
   typeof value.proofSha256==='string'&&/^[0-9a-f]{64}$/.test(value.proofSha256));
  return {id,ok,proof:ok?value.proof:null,required:hints[id]};
 });
 const readyForReview=Object.values(sourceGates).every(x=>x.ok)&&evidenceGates.every(x=>x.ok);
 return {format:'fabric-v2-phase1-release-preflight-v1',readyForReview,releaseAuthorized:false,
  level:readyForReview?'all-declared-evidence-awaits-release-authorization':'not-ready',
  sourceGates,evidenceGates,
  disclaimer:'Read-only source and evidence preflight. Passing does NOT verify production/runtime truth nor authorize database writes, cutover, deploy or deletion.'};
}
const here=resolve(fileURLToPath(import.meta.url),'..','..');
function evidenceFile(root,file){
 const full=resolve(root,file),rel=relative(root,full);
 if(rel.startsWith('..'+sep)||rel==='..'||rel.startsWith(sep)||!rel)
  throw Error('Unsafe evidence path');
 if(!existsSync(full))throw Error('Referenced release evidence file absent');
 let at=resolve(root);
 for(const part of rel.split(sep)){
  at=resolve(at,part);
  if(lstatSync(at).isSymbolicLink())throw Error('Symbolic link cannot serve as release evidence');
 }
 const realRoot=realpathSync(root),realFile=realpathSync(full);
 const realRel=relative(realRoot,realFile);
 if(realRel==='..'||realRel.startsWith('..'+sep)||realRel.startsWith(sep)||
  !statSync(full).isFile()||statSync(full).size>1_048_576)
  throw Error('Unsafe evidence file');
 return full;
}
function relativeEvidence(root,proof){
 if(!validProof(proof))throw Error('Invalid evidence proof path');
 return evidenceFile(root,proof.split('#',1)[0]);
}
export function loadEvidence(root,argv){
 if(argv[0]==='--status'&&argv.length===1)return {};
 if(argv[0]!=='--evidence'||argv.length!==2)throw Error('Use --status or --evidence RELATIVE_JSON');
 const rel=argv[1];
 if(typeof rel!=='string'||!/^docs\/operations\/[\w.\-\u4e00-\u9fa5/]+\.json$/i.test(rel))
  throw Error('Unsafe evidence manifest path');
 const manifest=evidenceFile(root,rel);
 if(statSync(manifest).size>131_072)throw Error('Evidence manifest oversized');
 const value=JSON.parse(readFileSync(manifest,'utf8'));
 if(!value||value.format!=='fabric-v2-phase1-evidence-v1'||!value.gates||
  typeof value.gates!=='object'||Array.isArray(value.gates))
  throw Error('Invalid release evidence manifest');
 for(const id of PHASE1_EVIDENCE_GATES){
  const row=value.gates[id];
  if(row?.status==='passed'){
   if(!validReviewer(row.reviewedBy)||typeof row.proofSha256!=='string'||
      !/^[0-9a-f]{64}$/.test(row.proofSha256))throw Error('Invalid release evidence reviewer or digest');
   const real=relativeEvidence(root,row.proof??'');
   const digest=createHash('sha256').update(readFileSync(real)).digest('hex');
   if(digest!==row.proofSha256)throw Error('Release evidence digest integrity mismatch');
  }
 }
 return value.gates;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const root=resolve(fileURLToPath(import.meta.url),'..','..');
  const evidence=loadEvidence(root,process.argv.slice(2));
  const result=assessPhase1({server:readFileSync(resolve(root,'server.ts'),'utf8'),
   app:readFileSync(resolve(root,'src/App.tsx'),'utf8'),
   productionRuntime:readFileSync(resolve(root,'server/product-master/v2ProductionRuntime.ts'),'utf8'),
   productionHttp:readFileSync(resolve(root,'server/product-master/v2ProductionHttp.ts'),'utf8'),evidence});
  console.log(JSON.stringify(result,null,2));
  if(!result.readyForReview)process.exitCode=2;
 }catch(error){
  console.error('Phase1 delivery preflight refused: '+String(error?.message??'unknown'));
  process.exitCode=2;
 }
}

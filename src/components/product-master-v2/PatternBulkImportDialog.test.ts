import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {PatternBulkImportDialog} from './PatternBulkImportDialog';
import {V2LeaveContext,readLeaveState,type LeaveRegistry} from './useV2LeaveProtection';

const imageId='a1111111-1111-4111-8111-111111111111';
const file=(name:string)=>({name,type:'image/jpeg',size:123} as File);
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

async function withDialog(run:(ui:{renderer:ReactTestRenderer;registry:LeaveRegistry;select(names:string[]):Promise<void>;selectFiles(files:File[],folder?:boolean):Promise<void>;start():Promise<void>;unmount():Promise<void>;closed():number;imported():number;nativeOpened():number})=>Promise<void>,options:{upload?:(file:File)=>Promise<string>;api?:typeof fetch;directorySupported?:boolean}={}){
 const priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{value:{activeElement:null,createElement:()=>options.directorySupported===false?{}:{webkitdirectory:false}},configurable:true});
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const registry:LeaveRegistry={current:new Map()};let renderer!:ReactTestRenderer,mounted=true,closed=0,imported=0,nativeOpened=0;
 try{
  await act(async()=>{renderer=create(React.createElement(V2LeaveContext.Provider,{value:registry},React.createElement(PatternBulkImportDialog,{apiFetch:options.api??(async()=>Response.json({},{status:201})),onUpload:options.upload??(async()=>imageId),onClose:()=>{closed++;},onImported:count=>{imported+=count;}})),{createNodeMock:element=>element.type==='dialog'?{showModal(){nativeOpened++;},close(){}}:null});});
  const unmount=async()=>{if(mounted){await act(async()=>renderer.unmount());mounted=false;}};
  const selectFiles=async(files:File[],folder=false)=>{await act(async()=>renderer.root.findAllByType('input')[folder?1:0].props.onChange({target:{files,value:'selected'}}));};
  await run({renderer,registry,select:async names=>selectFiles(names.map(file)),selectFiles,start:()=>renderer.root.findAllByType('button').find(node=>String(node.props.children).includes('开始导入'))!.props.onClick(),unmount,closed:()=>closed,imported:()=>imported,nativeOpened:()=>nativeOpened});
 }finally{if(mounted)await act(async()=>renderer.unmount());if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);else Reflect.deleteProperty(globalThis,'document');if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');}
}

test('failed explicit number does not block other numbers; retry requires reselecting files',async()=>{
 const uploaded:string[]=[],saved:string[]=[];let fail=true;
 await withDialog(async ui=>{
  await ui.select(['G0008-2.jpg','H0001-1.jpg','G0008-1.jpg']);
  await act(async()=>{await ui.start();});
  assert.deepEqual(uploaded,['G0008-1.jpg','G0008-2.jpg','H0001-1.jpg']);
  assert.deepEqual(saved,['G0008-2','H0001-1']);assert.equal(ui.imported(),2);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/upload interrupted/);
  fail=false;await ui.select(['G0008-2.jpg','G0008-1.jpg']);
  await act(async()=>{await ui.start();});
  assert.deepEqual(saved,['G0008-2','H0001-1','G0008-1','G0008-2']);assert.equal(ui.imported(),4);
 },{upload:async f=>{uploaded.push(f.name);if(fail&&f.name==='G0008-1.jpg')throw Error('upload interrupted');return imageId;},api:async(_url,init)=>{const body=JSON.parse(String(init?.body));saved.push(body.masterNo+'-'+body.colorwayNo);return Response.json({},{status:201});}});
});

test('uncertain POST is never retried and each other explicit number is attempted once',async()=>{
 const writes:string[]=[];
 await withDialog(async ui=>{
  await ui.select(['G0008-1.jpg','G0008-2.jpg','H0001-1.jpg']);
  await act(async()=>{await ui.start();});
  assert.deepEqual(writes,['G0008-1','G0008-2','H0001-1']);assert.equal(ui.imported(),1);
 },{api:async(_url,init)=>{const body=JSON.parse(String(init?.body));writes.push(body.masterNo+'-'+body.colorwayNo);if(body.masterNo==='G0008')throw Error('response lost after possible commit');return Response.json({},{status:201});}});
});

test('invalid file never uploads or posts while other explicit numbers remain importable',async()=>{
 const uploaded:string[]=[],writes:string[]=[];
 await withDialog(async ui=>{
  await act(async()=>ui.renderer.root.findAllByType('input')[0].props.onChange({target:{files:[{...file('G0008-1.jpg'),size:0},file('G0008-2.jpg'),file('H0001-1.jpg')],value:'selected'}}));
  await act(async()=>{await ui.start();});
  assert.deepEqual(uploaded,['G0008-2.jpg','H0001-1.jpg']);assert.deepEqual(writes,['G0008-2','H0001-1']);assert.equal(ui.imported(),2);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/非空文件/);
 },{upload:async f=>{uploaded.push(f.name);return imageId;},api:async(_url,init)=>{const body=JSON.parse(String(init?.body));writes.push(body.masterNo+'-'+body.colorwayNo);return Response.json({},{status:201});}});
});

test('all conflicting images are excluded while other explicit numbers import once',async()=>{
 const writes:string[]=[];
 await withDialog(async ui=>{
  await ui.select(['G0008-1.jpg','G0008-1.jpg','G0008-2.jpg','H0001-1.jpg']);await act(async()=>{await ui.start();});
  assert.deepEqual(writes,['G0008-2','H0001-1']);assert.equal(ui.imported(),2);assert.match(JSON.stringify(ui.renderer.toJSON()),/冲突文件全部排除/);
 },{api:async(_url,init)=>{const body=JSON.parse(String(init?.body));writes.push(body.masterNo+'-'+body.colorwayNo);return Response.json({},{status:201});}});
});

test('cancel bubbling from the file chooser leaves the import dialog open',async()=>{
 await withDialog(async ui=>{
  let prevented=false;const modal=ui.renderer.root.findByType('dialog');
  await act(async()=>modal.props.onCancel({target:ui.renderer.root.findAllByType('input')[0],currentTarget:modal,preventDefault(){prevented=true;}}));
  assert.equal(ui.closed(),0);assert.equal(prevented,false);
 });
});

test('native modal opens, idle cancel closes, and busy state protects leave, cancel and immediate double-submit',async()=>{
 const upload=deferred<string>();let uploads=0,pending!:Promise<void>;
 await withDialog(async ui=>{
  assert.equal(ui.nativeOpened(),1);
  const modal=ui.renderer.root.findByType('dialog');let prevented=0;
  await act(async()=>modal.props.onCancel({preventDefault(){prevented++;}}));assert.equal(ui.closed(),1);
  await ui.select(['G0008-1.jpg']);
  await act(async()=>{pending=ui.start();void ui.start();});
  assert.equal(uploads,1);assert.equal(readLeaveState(ui.registry).busy,true);
  await act(async()=>modal.props.onCancel({preventDefault(){prevented++;}}));assert.equal(ui.closed(),1);assert.equal(prevented,2);
  await act(async()=>{upload.resolve(imageId);await pending;});
  assert.equal(readLeaveState(ui.registry).busy,false);
  await act(async()=>modal.props.onCancel({preventDefault(){}}));assert.equal(ui.closed(),2);
 },{upload:async()=>{uploads++;return upload.promise;}});
});

test('forced unmount during upload prevents its POST and all subsequent uploads',async()=>{
 const upload=deferred<string>();let uploads=0,writes=0,pending!:Promise<void>;
 await withDialog(async ui=>{
  await ui.select(['G0008-1.jpg','G0008-2.jpg']);
  await act(async()=>{pending=ui.start();});await ui.unmount();upload.resolve(imageId);await pending;
  assert.equal(uploads,1);assert.equal(writes,0);assert.equal(ui.imported(),0);assert.equal(ui.registry.current.size,0);
 },{upload:async()=>{uploads++;return upload.promise;},api:async()=>{writes++;return Response.json({},{status:201});}});
});

test('forced unmount during an uncertain POST does not submit remaining entries or notify an abandoned page',async()=>{
 const post=deferred<Response>();let uploads=0,writes=0,pending!:Promise<void>;
 await withDialog(async ui=>{
  await ui.select(['G0008-1.jpg','G0008-2.jpg']);await act(async()=>{pending=ui.start();});
  assert.equal(writes,1);await ui.unmount();post.resolve(Response.json({},{status:201}));await pending;
  assert.equal(uploads,1);assert.equal(writes,1);assert.equal(ui.imported(),0);
 },{upload:async()=>{uploads++;return imageId;},api:async()=>{writes++;return post.promise;}});
});

test('explicit file and folder pickers replace a batch, retain cancellation and show nested local paths',async()=>{
 const writes:unknown[]=[];const uploaded:string[]=[];
 await withDialog(async ui=>{
  const inputs=ui.renderer.root.findAllByType('input');assert.equal(inputs.length,2);
  assert.equal(inputs[0].props.multiple,true);assert.equal(inputs[0].props['aria-label'],'选择多个文件');
  assert.equal(inputs[1].props.webkitdirectory,'');assert.equal(inputs[1].props.multiple,true);
  assert.equal(inputs[1].props['aria-label'],'选择文件夹');
  await ui.select(['G0008-1.jpg']);await ui.selectFiles([],true);
  assert.equal(readLeaveState(ui.registry).dirty,true);
  const nested={...file('H0001-2.jpg'),webkitRelativePath:'batch/G9999-8/deep/H0001-2.jpg'} as File;
  await ui.selectFiles([nested],true);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/batch\/G9999-8\/deep\/H0001-2.jpg/);
  await ui.selectFiles([]);await act(async()=>{await ui.start();});
  assert.deepEqual(uploaded,['H0001-2.jpg']);
  assert.deepEqual(writes,[{masterNo:'H0001',colorwayNo:2,patternImageAssetId:imageId}]);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/batch\/G9999-8\/deep\/H0001-2.jpg/);
 },{upload:async f=>{uploaded.push(f.name);return imageId;},api:async(_url,init)=>{writes.push(JSON.parse(String(init?.body)));return Response.json({},{status:201});}});
});

test('both pickers are disabled during upload and an already queued change cannot replace the batch',async()=>{
 const upload=deferred<string>();const uploaded:string[]=[];let pending!:Promise<void>;
 await withDialog(async ui=>{
  await ui.select(['G0008-1.jpg']);await act(async()=>{pending=ui.start();});
  assert.equal(ui.renderer.root.findAllByType('input').length,2);
  assert.ok(ui.renderer.root.findAllByType('input').every(input=>input.props.disabled));
  await ui.selectFiles([file('H0001-1.jpg')],true);
  await act(async()=>{upload.resolve(imageId);await pending;});
  assert.deepEqual(uploaded,['G0008-1.jpg']);
  assert.doesNotMatch(JSON.stringify(ui.renderer.toJSON()),/H0001-1.jpg/);
 },{upload:async f=>{uploaded.push(f.name);return upload.promise;}});
});

test('unsupported folder selection keeps the multiple-files fallback available',async()=>{
 await withDialog(async ui=>{
  const inputs=ui.renderer.root.findAllByType('input');assert.equal(inputs.length,2);
  assert.equal(inputs[1].props.disabled,true);assert.equal(inputs[0].props.disabled,false);
  assert.match(JSON.stringify(ui.renderer.toJSON()),/不支持文件夹选择/);
  await ui.select(['H0001-1.jpg']);await act(async()=>{await ui.start();});assert.equal(ui.imported(),1);
 },{directorySupported:false});
});

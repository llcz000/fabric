import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {ProductBatchCreateV2} from './ProductBatchCreateV2';
import {ProductChoiceDialog} from './ProductChoiceDialog';
import {ConfirmProvider} from '../ui/ConfirmDialog';
import type {ProductPatternChoice} from './productEditorModel';

const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const choice=(n:number):ProductPatternChoice=>({id:String(n),masterId:'1',colorwayNo:n,
 patternNo:'G0008-'+n,patternImageAssetId:null,remark:'',isActive:true,colorTags:[],topicTags:[]});

test('21st batch choice shows an in-dialog limit error, preserves 20 choices and recovers after deselection',async()=>{
 let renderer!:ReactTestRenderer;
 const api:typeof fetch=async()=>Response.json({items:[],total:0,limit:100,offset:0});
 await act(async()=>{renderer=create(React.createElement(ConfirmProvider,null,
  React.createElement(ProductBatchCreateV2,{apiFetch:api,onCancel(){},onSaved(){}})));});
 try{
  await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.includes('勾选花型配色'))!.props.onClick();});
  const dialog=()=>renderer.root.findByType(ProductChoiceDialog);
  for(let i=1;i<=20;i++)await act(async()=>dialog().props.onChooseVersion(choice(i)));
  assert.equal(dialog().props.multiSelectVersionIds.length,20);
  await act(async()=>dialog().props.onChooseVersion(choice(21)));
  assert.equal(dialog().props.multiSelectVersionIds.length,20);
  assert.match(dialog().props.selectionError,/最多.*20/);
  const renderedDialog=renderer.root.findAll(n=>n.props.role==='dialog')[0];
  assert(renderedDialog.findAll(n=>n.props.role==='alert').some(n=>n.children.join('').includes('20')));
  await act(async()=>dialog().props.onChooseVersion(choice(1)));
  assert.equal(dialog().props.multiSelectVersionIds.length,19);
  assert.equal(dialog().props.selectionError,'');
  await act(async()=>dialog().props.onChooseVersion(choice(21)));
  assert.deepEqual(dialog().props.multiSelectVersionIds,Array.from({length:20},(_,i)=>String(i+2)));
  await act(async()=>dialog().props.onClose());
  assert.equal(renderer.root.findAllByType(ProductChoiceDialog).length,0);
  const reopen=renderer.root.findAllByType('button').find(b=>b.children.includes('勾选花型配色'))!;
  assert.equal(reopen.props.disabled,false);
  await act(async()=>reopen.props.onClick());
  assert.equal(dialog().props.multiSelectVersionIds.length,20);
 }finally{await act(async()=>renderer.unmount());}
});

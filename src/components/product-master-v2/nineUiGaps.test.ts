import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CreatePattern} from './PatternWorkspaceV2';
import {ResetMemberPassword} from './V2MemberManager';
import {savePatternDraft,type PatternCreationProgress} from './patternCreateModel';
test('new pattern has colorway draft and image controls, password dialog identifies the member and confirms password',()=>{
 const create=renderToStaticMarkup(React.createElement(CreatePattern,{apiFetch:fetch,onCancel(){},onSaved(){}}));
 for(const text of ['添加配色','配色 1 花型图','保存花型'])assert(create.includes(text),text);
 const reset=renderToStaticMarkup(React.createElement(ResetMemberPassword,{member:{id:'7',username:'alice',display_name:'小王',role:'sales',is_active:1},busy:false,error:'',onClose(){},onSave:async()=>false}));
 for(const text of ['小王','alice','确认新密码','新密码'])assert(reset.includes(text),text);
});
test('partial acknowledged pattern creation resumes remaining drafts without duplicating confirmed identities',async()=>{
 const progress:PatternCreationProgress={};let masters=0,colors=0,fail=true;
 const api=(async(url)=>{
  if(url==='/api/v2/pattern-masters'){masters++;return Response.json({id:'7',masterNo:'AB'});}
  colors++;if(colors===2&&fail)return Response.json({},{status:400});
  const no=colors===3?2:colors;return Response.json({id:String(10+no),masterId:'7',masterNo:'AB',colorwayNo:no,patternNo:'AB-'+no,patternImageAssetId:null,remark:'',isActive:true});
 }) as typeof fetch;
 const drafts=[{key:'a',remark:''},{key:'b',remark:''}];
 await assert.rejects(savePatternDraft(api,'AB',drafts,progress));assert.equal(masters,1);
 fail=false;await savePatternDraft(api,'AB',drafts,progress);assert.equal(masters,1);assert.equal(colors,3);
});
test('ambiguous success cannot be retried and allocate a second saved identity',async()=>{
 const progress:PatternCreationProgress={};let calls=0;
 const api=(async()=>{calls++;return new Response('{',{status:201});}) as typeof fetch;
 await assert.rejects(savePatternDraft(api,'AB',[],progress));assert.equal(progress.uncertain,true);
 await assert.rejects(savePatternDraft(api,'AB',[],progress));assert.equal(calls,1);
});

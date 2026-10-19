import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {EditMemberProfile} from './V2MemberManager';
import {SampleSessionActions,Session} from './SampleBusinessWorkspaceV2';
test('member profile modal edits login and display name without resetting password or user identity',()=>{
 const html=renderToStaticMarkup(React.createElement(EditMemberProfile,{member:{id:'8',username:'original',display_name:'原姓名',role:'sales',is_active:1},busy:false,error:'',onClose(){},onSave:async()=>false}));
 assert(html.includes('value="original"'));assert(html.includes('value="原姓名"'));assert(html.includes('保存资料'));assert(!html.includes('type="password"'));
});
test('selection row offers view/edit/delete and view opens no write controls',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleSessionActions,{busy:false,onView(){},onEdit(){},onDelete(){}}));
 for(const action of ['查看','编辑','删除'])assert(html.includes('>'+action+'<'));
 const view=renderToStaticMarkup(React.createElement(Session,{session:{id:'7',customerReference:'客户',status:'open'},apiFetch:fetch,onBack(){},onStatusChanged(){},readOnly:true}));
 assert(!view.includes('结束选样单'));assert(!view.includes('扫码加入'));assert(!view.includes('修改客户'));
});

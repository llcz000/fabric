import assert from 'node:assert/strict';import test from 'node:test';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {SampleBusinessWorkspaceV2,Session} from './SampleBusinessWorkspaceV2';
test('sample workspace offers customer search/new selection and uses no browser requests or grant administration on render',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleBusinessWorkspaceV2,{apiFetch:async()=>{throw Error('No SSR requests');}}));
 for(const word of ['客户选样','客户名称','新建选样单','搜索客户'])assert(html.includes(word),word);
 assert(!html.includes('管理授权'));assert(!html.includes('按货号补选'));
});

test('mobile scan starts from an enabled camera action before there is a decoded token',()=>{
 const html=renderToStaticMarkup(React.createElement(Session,{session:{id:'7',customerReference:'客户',status:'open'},apiFetch:fetch,onBack(){},onStatusChanged(){}}));
 const start=html.match(/<input[^>]*data-scan-start[^>]*>/)?.[0];assert(start,'scan entry must open capture before a token exists');assert(!/\sdisabled(?:=|\s|>)/.test(start));assert(!html.includes('>确认加入</button>'),'no grey submit presented as the scan entry');
});

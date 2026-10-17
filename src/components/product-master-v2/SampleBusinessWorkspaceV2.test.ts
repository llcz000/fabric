import assert from 'node:assert/strict';import test from 'node:test';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {SampleBusinessWorkspaceV2} from './SampleBusinessWorkspaceV2';
test('sample workspace offers customer search/new selection and uses no browser requests or grant administration on render',()=>{
 const html=renderToStaticMarkup(React.createElement(SampleBusinessWorkspaceV2,{apiFetch:async()=>{throw Error('No SSR requests');}}));
 for(const word of ['客户选样','客户名称','新建选样单','搜索客户'])assert(html.includes(word),word);
 assert(!html.includes('管理授权'));assert(!html.includes('按货号补选'));
});

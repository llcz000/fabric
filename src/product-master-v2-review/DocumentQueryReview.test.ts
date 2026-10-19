import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DocumentQueryReview} from './DocumentQueryReview';
test('V2 review can open scoped stats and switch to document query without production mount',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentQueryReview,{initialMode:'stats'}));
 assert(html.includes('经营大盘'));
 assert(html.includes('单据查询'));
 assert(html.includes('演示角色'));
 assert(html.includes('仅本机内存'));
});

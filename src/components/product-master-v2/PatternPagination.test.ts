import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PatternPagination} from './PatternPagination';
import {parsePatternPage} from './patternModel';
test('pagination distinguishes 76 masters and 144 colorways, exposes current and final page',()=>{
 for(const offset of [0,60]){
  const html=renderToStaticMarkup(React.createElement(PatternPagination,{page:{items:[],total:76,totalColorways:144,limit:20,offset},onPage(){}}));
  assert.match(html,/76/);assert.match(html,/144/);assert.match(html,/每页 20 个花型/);
  assert(html.includes(offset===0?'第 1 / 4 页':'第 4 / 4 页'));
 }
 assert.throws(()=>parsePatternPage({items:[],total:0,totalColorways:-1,limit:20,offset:0}));
});

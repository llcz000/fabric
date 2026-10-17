import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initialPieceSlots,salesPieceDraft,SalesPieceInputs} from './SalesPieceInputs';
test('DOC-06 ten initial numeric positions preserve loaded values and do not cap many pieces',()=>{
 assert.equal(initialPieceSlots('').length,10);
 assert.deepEqual(initialPieceSlots('1.25, 2.50').slice(0,3),['1.25','2.50','']);
 assert.equal(initialPieceSlots(Array.from({length:235},()=>1).join(',')).length,235);
 const html=renderToStaticMarkup(React.createElement(SalesPieceInputs,{value:'',grossMeters:0,disabled:false,onChange:()=>{}}));
 assert.equal((html.match(/inputMode="decimal"/g)??[]).length,10);assert(html.includes('增加10匹输入位'));
});
test('DOC-06 only filled slots count as pieces, cents sum accurately; invalid partial inputs remain invalid for save',()=>{
 assert.deepEqual(salesPieceDraft(['0.10','','0.20']),{rollNo:'0.10, 0.20',meters:0.3,pieces:2,error:''});
 assert.deepEqual(salesPieceDraft(['','','']),{rollNo:'',meters:0,pieces:0,error:''});
 for(const value of ['0','-1','1e2','1.001','1.','Infinity'])assert(salesPieceDraft([value]).error,value);
 assert.equal(salesPieceDraft(['1.']).rollNo,'1.','not silently replaced by a previously saved valid value');
 const history=renderToStaticMarkup(React.createElement(SalesPieceInputs,{value:'',grossMeters:8,disabled:false,onChange:()=>{}}));
 assert(history.includes('暂保留原毛米数'));
});

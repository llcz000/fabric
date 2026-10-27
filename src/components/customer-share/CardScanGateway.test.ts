import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CardScanGateway from './CardScanGateway';

test('unknown browser purpose offers separate public viewing and employee login choices',()=>{
 const html=renderToStaticMarkup(React.createElement(CardScanGateway,{token:'QR_0123456789abcdef0123456789abcdef',internal:React.createElement('div',null,'PRIVATE_CUSTOMER_RECORDS')}));
 for(const phrase of ['查看色卡','员工选样','无需登录','系统账号登录','请选择使用方式'])assert(html.includes(phrase));
 assert(!html.includes('PRIVATE_CUSTOMER_RECORDS'));
});

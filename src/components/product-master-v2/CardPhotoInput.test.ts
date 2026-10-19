import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CardPhotoInput} from './CardPhotoInput';
const view=(disabled=false)=>renderToStaticMarkup(React.createElement(CardPhotoInput,{disabled,onDecoded(){},onBusyChange(){}}));
test('selection scan offers live camera only without photo or album inputs',()=>{const html=view();assert.match(html,/data-live-scan/);assert(!html.includes('<input'));assert(!html.includes('拍照识别'));assert(!html.includes('从相册识别'));assert(!html.includes('disabled=""'));});
test('live camera action is disabled during a conflicting write',()=>{assert.match(view(true),/<button[^>]*data-live-scan[^>]*disabled=""/);});

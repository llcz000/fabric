import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CardPhotoInput} from './CardPhotoInput';
const view=(disabled=false)=>renderToStaticMarkup(React.createElement(CardPhotoInput,{disabled,onDecoded(){},onBusyChange(){}}));
test('camera entry is a direct native image input and album offers a separate path without capture',()=>{
 const html=view(),inputs=html.match(/<input[^>]+>/g)??[];assert.equal(inputs.length,2,'camera failure needs independent album input');
 const camera=inputs.find(input=>input.includes('data-scan-start'));assert(camera&&camera.includes('type="file"')&&camera.includes('capture="environment"')&&camera.includes('accept="image/*"'));assert(!camera.includes('disabled=""'));assert(!camera.includes('sr-only'));assert(!camera.includes('tabindex="-1"'));
 const album=inputs.find(input=>input.includes('aria-label="从相册识别色卡"'));assert(album&&!album.includes('capture=')&&album.includes('accept="image/*"'));assert(html.includes('从相册识别'));
});
test('both native photo choices are disabled during a conflicting write',()=>{const inputs=view(true).match(/<input[^>]+>/g)??[];assert(inputs.length>0&&inputs.every(input=>input.includes('disabled=""')));});

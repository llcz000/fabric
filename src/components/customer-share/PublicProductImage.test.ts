import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {PublicProductImage} from './PublicProductImage';
test('customer product images provide an explicit large-view button using only the supplied controlled preview',()=>{
 const src='/api/public/products/'+'a'.repeat(43)+'/images/'+'b'.repeat(43);
 const html=renderToStaticMarkup(React.createElement(PublicProductImage,{src,description:'面料大图 1'}));
 assert(html.includes('查看大图 面料大图 1'));assert(html.includes(src));assert(html.includes('loading="lazy"'));assert(!html.includes('original'));
});

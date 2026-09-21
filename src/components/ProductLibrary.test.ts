/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThumbnailCell } from './ProductLibrary';
import type { ProductImageDescriptor } from '../types';

test('product thumbnails render as buttons that identify the selected lightbox image', () => {
  const images: ProductImageDescriptor[] = [
    {
      source: 'asset', role: 'pattern_original', sortOrder: 0, isPrimary: true,
      assetId: 'asset-pattern', thumbnailUrl: '/thumb-pattern', displayUrl: '/display-pattern',
    },
    {
      source: 'asset', role: 'detail', sortOrder: 1, isPrimary: false,
      assetId: 'asset-gallery', thumbnailUrl: '/thumb-gallery', displayUrl: '/display-gallery',
    },
  ];

  const markup = renderToStaticMarkup(React.createElement(ThumbnailCell, {
    productId: '17',
    images,
  }));

  assert.equal((markup.match(/<button/g) ?? []).length, 2);
  assert.match(markup, /data-product-id="17"/);
  assert.match(markup, /data-lightbox-asset-id="asset-pattern"/);
  assert.match(markup, /data-lightbox-asset-id="asset-gallery"/);

  const renderThumbnailCell = (ThumbnailCell as unknown as {
    type: (props: { productId: string; images: ProductImageDescriptor[] }) => React.ReactElement<{ children?: React.ReactNode }>;
  }).type;
  const tree = renderThumbnailCell({ productId: '17', images });
  const buttons = React.Children.toArray(tree.props.children) as Array<React.ReactElement<{ onClick?: () => void }>>;
  assert.equal(typeof buttons[1].props.onClick, 'function');

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let opened: CustomEvent<{ productId: string; assetId: string }> | undefined;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: CustomEvent<{ productId: string; assetId: string }>) => { opened = event; return true; } },
  });
  try {
    buttons[1].props.onClick!();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
  assert.equal(opened?.type, 'open-lightbox');
  assert.deepEqual(opened?.detail, { productId: '17', assetId: 'asset-gallery' });
});

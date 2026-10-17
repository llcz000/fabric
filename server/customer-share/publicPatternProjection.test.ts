import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPublicPattern, type PatternCandidate, type PreviewCandidate } from './publicPatternProjection';

const approved = { isPublicApproved: true, isActive: true };
const sensitive = {
  id: 'INTERNAL-ID', price: 88, remark: 'SECRET-NOTE', sourceFile: '/private/design.psd',
  customer: { name: 'SECRET-CUSTOMER' }, salesOwner: 'SECRET-SALES',
  followups: ['SECRET-FOLLOWUP'], samples: ['SECRET-SAMPLE'], selectedItems: ['SECRET-SELECTION'],
};
function preview(role: string, token: string): PreviewCandidate {
  return { ...approved, ...sensitive, kind: 'display', role, previewRef: `display:${token}`,
    privateUrl: 'https://private.cos.example/original.jpg' };
}
function fixture(): PatternCandidate {
  return {
    ...approved, ...sensitive, patternNo: '001234', colorways: [{
      ...approved, ...sensitive, colorwayNumber: 1, designImages: [preview('design', 'design-one')],
      products: [{
        ...approved, ...sensitive, fabric: {
          ...approved, ...sensitive, fabricNo: 'F018', fabricName: 'Silk', composition: '100% silk',
          weightValue: 16, weightUnit: 'mm', widthCm: 140,
        }, images: [preview('display', 'fabric-one'), preview('detail', 'detail-one'), preview('effect', 'effect-one')],
      }],
    }],
  };
}

test('exact output whitelist discards sensitive fields at every nested level', () => {
  assert.deepEqual(projectPublicPattern(fixture()), {
    patternNo: '001234', colorways: [{
      colorwayNumber: 1, designImages: [{ previewRef: 'display:design-one' }], fabrics: [{
        fabricNo: 'F018', fabricName: 'Silk', composition: '100% silk',
        weightValue: 16, weightUnit: 'mm', widthCm: 140,
        displayImages: [{ previewRef: 'display:fabric-one' }],
        detailImages: [{ previewRef: 'display:detail-one' }],
        effectImages: [{ previewRef: 'display:effect-one' }],
      }],
    }],
  });
});

test('each colorway and each fabric keeps its own specifications and images', () => {
  const input = fixture();
  const first = input.colorways[0];
  first.products.push({ ...approved, fabric: {
    ...approved, fabricNo: 'F022', fabricName: 'Cotton', composition: '100% cotton',
    weightValue: 120, weightUnit: 'gsm', widthCm: 150,
  }, images: [preview('effect', 'cotton-one')] });
  input.colorways.push({ ...approved, colorwayNumber: 3, designImages: [preview('design', 'design-three')],
    products: [{ ...approved, fabric: { ...first.products[0].fabric }, images: [preview('effect', 'silk-three')] }] });
  const output = projectPublicPattern(input)!;
  assert.deepEqual(output.colorways.map(c => ({ number: c.colorwayNumber, designs: c.designImages,
    fabrics: c.fabrics.map(f => [f.fabricNo, f.weightValue, f.weightUnit, f.widthCm, f.effectImages]) })), [
    { number: 1, designs: [{ previewRef: 'display:design-one' }], fabrics: [
      ['F018', 16, 'mm', 140, [{ previewRef: 'display:effect-one' }]],
      ['F022', 120, 'gsm', 150, [{ previewRef: 'display:cotton-one' }]],
    ] },
    { number: 3, designs: [{ previewRef: 'display:design-three' }], fabrics: [
      ['F018', 16, 'mm', 140, [{ previewRef: 'display:silk-three' }]],
    ] },
  ]);
});

test('approval and activity must be explicit booleans on pattern, colorway, product and fabric', () => {
  for (const field of ['isPublicApproved', 'isActive'] as const) {
    for (const value of [false, undefined, null, 1, 'true']) {
      for (const level of ['pattern', 'colorway', 'product', 'fabric']) {
        const input = fixture();
        const c = input.colorways[0];
        const p = c.products[0];
        const target = level === 'pattern' ? input : level === 'colorway' ? c : level === 'product' ? p : p.fabric;
        target[field] = value;
        const output = projectPublicPattern(input);
        if (level === 'pattern') assert.equal(output, null);
        else if (level === 'colorway') assert.deepEqual(output!.colorways, []);
        else assert.deepEqual(output!.colorways[0].fabrics, []);
      }
    }
  }
});

test('missing images and nullable specifications remain empty without borrowing from other groups', () => {
  const input = fixture();
  input.colorways.push({ ...approved, colorwayNumber: 2, designImages: null, products: [{
    ...approved, fabric: { ...approved, fabricNo: 'F099', fabricName: 'Unspecified',
      composition: null, weightValue: null, weightUnit: null, widthCm: null },
  }] });
  assert.deepEqual(projectPublicPattern(input)!.colorways[1], {
    colorwayNumber: 2, designImages: [], fabrics: [{
      fabricNo: 'F099', fabricName: 'Unspecified', composition: null,
      weightValue: null, weightUnit: null, widthCm: null,
      displayImages: [], detailImages: [], effectImages: [],
    }],
  });
});

test('only approved active display previews with the correct role and opaque ref survive', () => {
  const input = fixture();
  const allowed = preview('effect', 'safe');
  input.colorways[0].products[0].images = [allowed,
    ...['original', 'source', 'download', 'thumbnail'].map(kind => ({ ...allowed, kind })),
    { ...allowed, role: 'design' }, { ...allowed, role: 'unknown' },
    ...['', '/private/image.jpg', 'C:\\private\\image.jpg', 'https://private.cos.example/raw.jpg',
      '//private.cos.example/raw.jpg', 'display:../raw', 'display:%2Fraw', 'display:safe\n'].map(previewRef => ({ ...allowed, previewRef })),
    ...[false, undefined, 1, 'true'].flatMap(value => [
      { ...allowed, isPublicApproved: value }, { ...allowed, isActive: value },
    ]),
  ];
  input.colorways[0].designImages = [preview('effect', 'wrong-role'),
    { ...preview('design', 'private'), kind: 'source' }, preview('design', 'safe-design')];
  const output = projectPublicPattern(input)!.colorways[0];
  assert.deepEqual(output.designImages, [{ previewRef: 'display:safe-design' }]);
  assert.deepEqual(output.fabrics[0].displayImages, []);
  assert.deepEqual(output.fabrics[0].detailImages, []);
  assert.deepEqual(output.fabrics[0].effectImages, [{ previewRef: 'display:safe' }]);
});

function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}
test('projection neither mutates nor aliases input and reprojects current backend data', () => {
  const input = fixture();
  const before = structuredClone(input);
  deepFreeze(input);
  const old = projectPublicPattern(input)!;
  assert.deepEqual(input, before);
  old.colorways[0].designImages[0].previewRef = 'display:changed-output';
  old.colorways[0].fabrics[0].fabricName = 'Changed output';
  assert.deepEqual(input, before);
  const refreshed = structuredClone(input);
  refreshed.colorways[0].products[0].fabric.fabricName = 'Updated silk';
  refreshed.colorways[0].products[0].images!.push(preview('effect', 'new-effect'));
  const current = projectPublicPattern(refreshed)!;
  assert.equal(current.patternNo, old.patternNo);
  assert.equal(current.colorways[0].fabrics[0].fabricName, 'Updated silk');
  assert.deepEqual(current.colorways[0].fabrics[0].effectImages, [
    { previewRef: 'display:effect-one' }, { previewRef: 'display:new-effect' },
  ]);
  refreshed.colorways[0].products[0].isPublicApproved = false;
  assert.deepEqual(projectPublicPattern(refreshed)!.colorways[0].fabrics, []);
});

test('whitelisted scalar fields cannot smuggle objects and unknown units never invent specifications', () => {
  const input = fixture();
  Object.assign(input.colorways[0].products[0].fabric, {
    composition: { price: 88 }, weightValue: { id: 'PRIVATE' }, weightUnit: 'kg', widthCm: NaN,
  });
  const fabric = projectPublicPattern(input)!.colorways[0].fabrics[0];
  assert.equal(fabric.composition, null);
  assert.equal(fabric.weightValue, null);
  assert.equal(fabric.weightUnit, null);
  assert.equal(fabric.widthCm, null);
  Object.assign(input, { patternNo: { id: 'PRIVATE' } });
  assert.equal(projectPublicPattern(input), null);
});

test('each product image role is capped independently at ten controlled previews', () => {
  const input = fixture();
  input.colorways[0].products[0].images = ['display', 'detail', 'effect'].flatMap(role =>
    Array.from({ length: 11 }, (_, i) => preview(role, `${role}-${i}`)));
  const fabric = projectPublicPattern(input)!.colorways[0].fabrics[0];
  for (const role of ['display', 'detail', 'effect'] as const) {
    assert.deepEqual(fabric[`${role}Images`], Array.from({ length: 10 }, (_, i) => ({ previewRef: `display:${role}-${i}` })));
  }
});

// Cast only at this test boundary to model malformed database-derived values.
function projectDatabaseValue(value: unknown) {
  return projectPublicPattern(value as PatternCandidate);
}

test('malformed pattern entities are rejected without throwing', () => {
  for (const value of [null, undefined, false, 7, 'pattern', {},
    Object.assign([], approved, { patternNo: '001234', colorways: [] })]) {
    assert.equal(projectDatabaseValue(value), null);
  }
});

test('missing or non-array colorways reject the whole pattern without iterating', () => {
  const colorway = fixture().colorways[0];
  const missing = fixture();
  Reflect.deleteProperty(missing, 'colorways');
  assert.equal(projectDatabaseValue(missing), null);
  for (const colorways of [null, false, 7, 'colorways', {},
    { 0: colorway, length: 1 }, new Set([colorway])]) {
    assert.equal(projectDatabaseValue({ ...fixture(), colorways }), null);
  }
});

test('malformed colorway entities are omitted while a valid sibling survives', () => {
  const good = fixture().colorways[0];
  const malformed = [null, undefined, false, 7, 'colorway', {},
    Object.assign([], good)];
  const output = projectDatabaseValue({ ...fixture(), colorways: [...malformed, good] })!;
  assert.equal(output.colorways.length, 1);
  assert.equal(output.colorways[0].colorwayNumber, 1);
  assert.equal(output.colorways[0].fabrics.length, 1);
});

test('colorways with missing or non-array products are omitted without iterating', () => {
  const good = fixture().colorways[0];
  const missing = { ...good };
  Reflect.deleteProperty(missing, 'products');
  const malformed = [missing, ...[null, false, 7, 'products', {},
    { 0: good.products[0], length: 1 }, new Set(good.products)]
    .map(products => ({ ...good, colorwayNumber: 2, products }))];
  const output = projectDatabaseValue({ ...fixture(), colorways: [...malformed, good] })!;
  assert.deepEqual(output.colorways.map(c => c.colorwayNumber), [1]);
  assert.equal(output.colorways[0].fabrics.length, 1);
});

test('malformed product entities are omitted while a valid sibling survives', () => {
  const input = fixture();
  const colorway = input.colorways[0];
  const good = colorway.products[0];
  Object.assign(colorway, { products: [null, undefined, false, 7, 'product', {},
    Object.assign([], good), good] });
  assert.equal(projectDatabaseValue(input)!.colorways[0].fabrics.length, 1);
});

test('products with missing or malformed fabrics are omitted while a valid sibling survives', () => {
  const input = fixture();
  const colorway = input.colorways[0];
  const good = colorway.products[0];
  const missing = { ...good };
  Reflect.deleteProperty(missing, 'fabric');
  Object.assign(colorway, { products: [missing, ...[null, false, 7, 'fabric', {},
    Object.assign([], good.fabric)].map(fabric => ({ ...good, fabric })), good] });
  const fabrics = projectDatabaseValue(input)!.colorways[0].fabrics;
  assert.equal(fabrics.length, 1);
  assert.equal(fabrics[0].fabricNo, 'F018');
});

for (const level of ['design', 'product'] as const) {
  test(`non-array ${level} image collections produce no images without iterating`, () => {
    const valid = preview(level === 'design' ? 'design' : 'effect', 'safe');
    for (const images of [undefined, null, false, 7, 'images', {},
      { 0: valid, length: 1 }, new Set([valid])]) {
      const input = fixture();
      const colorway = input.colorways[0];
      Object.assign(level === 'design' ? colorway : colorway.products[0],
        level === 'design' ? { designImages: images } : { images });
      const output = projectDatabaseValue(input)!.colorways[0];
      if (level === 'design') assert.deepEqual(output.designImages, []);
      else {
        assert.deepEqual(output.fabrics[0].displayImages, []);
        assert.deepEqual(output.fabrics[0].detailImages, []);
        assert.deepEqual(output.fabrics[0].effectImages, []);
      }
    }
  });

  test(`malformed ${level} image members are skipped without mutating or aliasing data`, () => {
    const input = fixture();
    const colorway = input.colorways[0];
    const valid = preview(level === 'design' ? 'design' : 'effect', 'safe');
    const images = [null, undefined, false, 7, 'image', {}, Object.assign([], valid), valid];
    Object.assign(level === 'design' ? colorway : colorway.products[0],
      level === 'design' ? { designImages: images } : { images });
    const before = structuredClone(input);
    deepFreeze(input);
    const output = projectDatabaseValue(input)!.colorways[0];
    const result = level === 'design' ? output.designImages : output.fabrics[0].effectImages;
    assert.deepEqual(result, [{ previewRef: 'display:safe' }]);
    result[0].previewRef = 'display:changed-output';
    assert.deepEqual(input, before);
  });
}

test('design images retain the ten-image cap after skipping malformed members', () => {
  const input = fixture();
  Object.assign(input.colorways[0], { designImages: [null,
    ...Array.from({ length: 11 }, (_, i) => preview('design', `design-${i}`))] });
  assert.deepEqual(projectDatabaseValue(input)!.colorways[0].designImages,
    Array.from({ length: 10 }, (_, i) => ({ previewRef: `display:design-${i}` })));
});

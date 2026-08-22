import assert from 'node:assert/strict';
import test from 'node:test';

import * as imageCapture from './imageCapture';

type Role = 'brand_logo' | 'wechat_qr' | 'alipay_qr';

class FakeImage {
  complete = true;
  naturalWidth = 8;
  decoded = 0;

  constructor(
    public src: string,
    public readonly dataset: Record<string, string> = {},
  ) {}

  cloneNode(): FakeImage {
    return new FakeImage(this.src, { ...this.dataset });
  }

  async decode(): Promise<void> {
    this.decoded += 1;
  }
}

class FakeRoot {
  constructor(public readonly images: FakeImage[]) {}

  cloneNode(): FakeRoot {
    return new FakeRoot(this.images.map((image) => image.cloneNode()));
  }

  querySelectorAll(selector: string): FakeImage[] {
    assert.equal(selector, 'img');
    return this.images;
  }
}

function protectedImage(role: Role, remoteSrc = `https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/${role}.png`): FakeImage {
  return new FakeImage(remoteSrc, { companyImageRole: role });
}

test('prepares protected company images through authenticated same-origin content endpoints instead of COS or proxy URLs', async () => {
  assert.equal(typeof imageCapture.prepareCaptureClone, 'function');
  const source = new FakeRoot([
    protectedImage('brand_logo'),
    protectedImage('wechat_qr'),
    protectedImage('alipay_qr'),
  ]);
  const fetches: string[] = [];
  const created: string[] = [];

  const prepared = await imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input) => {
    fetches.push(String(input));
    return new Response(new Blob([String(input)], { type: 'image/png' }));
  }, {
    createObjectUrl: () => {
      const url = `blob:prepared-${created.length}`;
      created.push(url);
      return url;
    },
  });

  assert.deepEqual(fetches, [
    '/api/company/images/brand_logo/content',
    '/api/company/images/wechat_qr/content',
    '/api/company/images/alipay_qr/content',
  ]);
  assert.deepEqual(source.images.map((image) => image.src), [
    'https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/brand_logo.png',
    'https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/wechat_qr.png',
    'https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/alipay_qr.png',
  ]);
  assert.deepEqual((prepared.clone as unknown as FakeRoot).images.map((image) => image.src), created);
});

test('waits for Blob-backed logo and both QR inputs to decode before capture and preserves recognizable non-empty image bytes', async () => {
  assert.equal(typeof imageCapture.prepareCaptureClone, 'function');
  const source = new FakeRoot([
    protectedImage('brand_logo'),
    protectedImage('wechat_qr'),
    protectedImage('alipay_qr'),
  ]);
  const blobs = new Map<string, Blob>();
  let nextUrl = 0;

  const prepared = await imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input) => {
    const role = String(input).split('/')[4];
    return new Response(new Blob([`fixture-${role}-pixels`], { type: 'image/png' }));
  }, {
    createObjectUrl: (blob) => {
      const url = `blob:fixture-${nextUrl++}`;
      blobs.set(url, blob);
      return url;
    },
  });
  const captureImages = (prepared.clone as unknown as FakeRoot).images;

  assert.deepEqual(captureImages.map((image) => image.decoded), [1, 1, 1]);
  assert.deepEqual(
    await Promise.all(captureImages.map((image) => blobs.get(image.src)?.text())),
    ['fixture-brand_logo-pixels', 'fixture-wechat_qr-pixels', 'fixture-alipay_qr-pixels'],
  );
  assert.ok(captureImages.every((image) => image.src.startsWith('blob:')));
});

test('handles missing or partial company images without fetching absent roles', async () => {
  assert.equal(typeof imageCapture.prepareCaptureClone, 'function');
  const source = new FakeRoot([
    protectedImage('brand_logo'),
    new FakeImage('data:image/png;base64,legacy'),
    new FakeImage('/uploads/static-stamp.png'),
  ]);
  const fetches: string[] = [];

  const prepared = await imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input) => {
    fetches.push(String(input));
    return new Response(new Blob(['logo'], { type: 'image/png' }));
  }, { createObjectUrl: () => 'blob:logo' });

  assert.deepEqual(fetches, ['/api/company/images/brand_logo/content']);
  assert.deepEqual((prepared.clone as unknown as FakeRoot).images.map((image) => image.src), [
    'blob:logo',
    'data:image/png;base64,legacy',
    '/uploads/static-stamp.png',
  ]);
});

test('converts all three feature-off legacy company images through same-origin role endpoints', async () => {
  assert.equal(typeof imageCapture.prepareCaptureClone, 'function');
  const source = new FakeRoot([
    protectedImage('brand_logo', 'https://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/legacy-logo.png'),
    protectedImage('wechat_qr', 'http://fabric-images-1448065940.cos.ap-shanghai.myqcloud.com/legacy-wechat.png'),
    protectedImage('alipay_qr', 'data:image/png;base64,legacy-alipay'),
  ]);
  const blobs = new Map<string, Blob>();
  const requests: string[] = [];

  const prepared = await imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input) => {
    requests.push(String(input));
    return new Response(new Blob([`legacy-${String(input).split('/')[4]}-pixels`], { type: 'image/png' }));
  }, {
    createObjectUrl: (blob) => {
      const url = `blob:legacy-${blobs.size}`;
      blobs.set(url, blob);
      return url;
    },
  });

  const cloneImages = (prepared.clone as unknown as FakeRoot).images;
  assert.deepEqual(requests, [
    '/api/company/images/brand_logo/content',
    '/api/company/images/wechat_qr/content',
    '/api/company/images/alipay_qr/content',
  ]);
  assert.deepEqual(
    await Promise.all(cloneImages.map((image) => blobs.get(image.src)?.text())),
    ['legacy-brand_logo-pixels', 'legacy-wechat_qr-pixels', 'legacy-alipay_qr-pixels'],
  );
  assert.ok(cloneImages.every((image) => image.decoded === 1 && image.src.startsWith('blob:')));
});

test('revokes every Blob URL after successful export cleanup', async () => {
  assert.equal(typeof imageCapture.releaseCaptureResources, 'function');
  const revoked: string[] = [];
  imageCapture.releaseCaptureResources(['blob:one', 'blob:two'], {
    revokeObjectUrl: (url) => revoked.push(url),
  });
  assert.deepEqual(revoked, ['blob:one', 'blob:two']);

});

test('revokes a Blob URL created by a pending image when a sibling protected image fails', async () => {
  const source = new FakeRoot([protectedImage('brand_logo'), protectedImage('wechat_qr')]);
  let resolveLogo!: (response: Response) => void;
  const created: string[] = [];
  const revoked: string[] = [];

  const failed = imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input) => {
    if (String(input).includes('brand_logo')) {
      return new Promise<Response>((resolve) => { resolveLogo = resolve; });
    }
    return new Response(null, { status: 403 });
  }, {
    createObjectUrl: () => {
      const url = 'blob:logo';
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
  });

  resolveLogo(new Response(new Blob(['logo'], { type: 'image/png' })));
  await assert.rejects(failed, /图片请求失败/);
  assert.deepEqual(created, ['blob:logo']);
  assert.deepEqual(revoked, ['blob:logo']);
});

test('aborting an export releases a ready Blob URL while a sibling request is hung', async () => {
  const source = new FakeRoot([protectedImage('brand_logo'), protectedImage('wechat_qr')]);
  const controller = new AbortController();
  const created: string[] = [];
  const revoked: string[] = [];

  const pending = imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input, init) => {
    if (String(input).includes('brand_logo')) {
      return new Response(new Blob(['logo'], { type: 'image/png' }));
    }
    assert.ok(init?.signal, 'protected content fetch must receive the export AbortSignal');
    return new Promise<Response>(() => {});
  }, {
    signal: controller.signal,
    timeoutMs: 10_000,
    createObjectUrl: () => {
      created.push('blob:logo');
      controller.abort(new DOMException('preview unmounted', 'AbortError'));
      return 'blob:logo';
    },
    revokeObjectUrl: (url) => revoked.push(url),
  });

  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  assert.deepEqual(created, ['blob:logo']);
  assert.deepEqual(revoked, ['blob:logo']);
});

test('times out a non-cooperative protected image request and cleans partial resources', async () => {
  const source = new FakeRoot([protectedImage('brand_logo'), protectedImage('wechat_qr')]);
  const revoked: string[] = [];
  const pending = imageCapture.prepareCaptureClone(source as unknown as HTMLElement, async (input) => {
    if (String(input).includes('brand_logo')) {
      return new Response(new Blob(['logo'], { type: 'image/png' }));
    }
    return new Promise<Response>(() => {});
  }, {
    timeoutMs: 10,
    createObjectUrl: () => 'blob:logo',
    revokeObjectUrl: (url) => revoked.push(url),
  });

  await assert.rejects(
    Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 250)),
    ]),
    (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
  );
  assert.deepEqual(revoked, ['blob:logo']);
});

test('repeated captures release each export only after its capture callback settles', async () => {
  assert.equal(typeof imageCapture.withPreparedCapture, 'function');
  const revoked: string[] = [];
  let finishFirst!: () => void;
  const source = new FakeRoot([protectedImage('brand_logo')]);
  const resources = {
    createObjectUrl: (() => {
      let index = 0;
      return () => `blob:export-${++index}`;
    })(),
    revokeObjectUrl: (url: string) => revoked.push(url),
  };
  const apiFetch = async () => new Response(new Blob(['logo'], { type: 'image/png' }));

  const first = imageCapture.withPreparedCapture(source as unknown as HTMLElement, apiFetch, async () => {
    await new Promise<void>((resolve) => { finishFirst = resolve; });
    return 'first';
  }, resources);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(revoked, [], 'capture resources must remain live until rendering finishes');
  finishFirst();
  assert.equal(await first, 'first');
  assert.deepEqual(revoked, ['blob:export-1']);

  const second = await imageCapture.withPreparedCapture(
    source as unknown as HTMLElement,
    apiFetch,
    async () => 'second',
    resources,
  );
  assert.equal(second, 'second');
  assert.deepEqual(revoked, ['blob:export-1', 'blob:export-2']);
});

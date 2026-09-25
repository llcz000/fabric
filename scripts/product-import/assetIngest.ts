import type { AssetDescriptor } from '../../server/image-assets/types';
import type { MaterializedImportImage } from './imagePlan';

interface ImportAssetRuntime {
  storageProvider: 'local' | 'cos';
  service: {
    createUploadSession(input: { purpose: 'product_image'; originalFilename: string; declaredMime: string; declaredByteSize: number; principalId: string }): Promise<{ sessionId: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }>;
    finalizeUploadSession(sessionId: string, principalId: string): Promise<AssetDescriptor>;
    getDescriptor(assetId: string, principalId: string): Promise<AssetDescriptor>;
  } | null;
  worker: { runOnce(): Promise<boolean> } | null;
  uploadLocalContent?(sessionId: string, input: { body: Buffer; contentLength: number; contentType: string; principalId: string }): Promise<void>;
}

export class AssetIngestor {
  constructor(private readonly runtime: ImportAssetRuntime) {}

  async ingest(image: MaterializedImportImage, filename: string, principalId: string): Promise<{ assetId: string }> {
    const service = this.runtime.service;
    if (!service || !this.runtime.worker) throw new Error('IMAGE_RUNTIME_UNAVAILABLE');
    const grant = await service.createUploadSession({ purpose: 'product_image', originalFilename: filename, declaredMime: image.mime, declaredByteSize: image.body.length, principalId });
    if (this.runtime.storageProvider === 'local') {
      if (!this.runtime.uploadLocalContent) throw new Error('LOCAL_UPLOAD_UNAVAILABLE');
      await this.runtime.uploadLocalContent(grant.sessionId, { body: image.body, contentLength: image.body.length, contentType: image.mime, principalId });
    } else {
      if (!grant.uploadUrl.startsWith('https://')) throw new Error('UNSAFE_UPLOAD_GRANT');
      const response = await fetch(grant.uploadUrl, { method: 'PUT', headers: grant.headers, body: new Uint8Array(image.body) });
      if (!response.ok) throw new Error('STORAGE_UPLOAD_FAILED');
    }
    let descriptor = await service.finalizeUploadSession(grant.sessionId, principalId);
    for (let attempt = 0; descriptor.status === 'processing' && attempt < 10; attempt += 1) {
      if (!await this.runtime.worker.runOnce()) break;
      descriptor = await service.getDescriptor(descriptor.id, principalId);
    }
    if (descriptor.status !== 'ready') throw Object.assign(new Error('Imported asset did not become ready'), { code: descriptor.errorCode ?? 'ASSET_NOT_READY' });
    return { assetId: descriptor.id };
  }
}


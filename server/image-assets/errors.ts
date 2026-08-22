export type ImageAssetErrorCode =
  | 'UPLOAD_SESSION_EXPIRED'
  | 'IMAGE_CONTENT_INVALID'
  | 'IMAGE_LIMIT_EXCEEDED'
  | 'ASSET_NOT_READY'
  | 'ASSET_ACCESS_DENIED'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_PROCESSING_FAILED'
  | 'STORAGE_UNAVAILABLE';

export class ImageAssetError extends Error {
  constructor(
    public readonly code: ImageAssetErrorCode,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ImageAssetError';
  }

  toResponse(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        retryable: this.retryable,
      },
    };
  }
}

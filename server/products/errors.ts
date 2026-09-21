export type ProductErrorCode =
  | 'PRODUCT_INVALID'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_LAYOUT_STALE'
  | 'PRODUCT_CONFLICT'
  | 'PRODUCT_FAILED';

export class ProductError extends Error {
  constructor(
    public readonly code: ProductErrorCode,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ProductError';
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

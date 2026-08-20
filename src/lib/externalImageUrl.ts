export function parseExternalImageUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP or HTTPS image URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed');
  }
  return url;
}

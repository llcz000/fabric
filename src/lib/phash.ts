/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Perceptual image hashing (dHash - Difference Hash).
 * Used for similar image search in product library.
 *
 * Algorithm:
 *   1. Resize image to 9x8 pixels
 *   2. Convert to grayscale
 *   3. Compare adjacent pixels horizontally: left < right → 1, else 0
 *   4. Result: 64-bit hash as 16-char hex string
 */

export async function computeImageHash(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const hash = computeDHash(img);
        resolve(hash);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for hashing'));
    };
    img.src = url;
  });
}

export async function computeImageHashFromUrl(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  const blob = await res.blob();
  return computeImageHash(blob);
}

function computeDHash(img: HTMLImageElement): string {
  // Resize to 9x8 using canvas
  const width = 9;
  const height = 8;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Convert to grayscale values
  const grays: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    // BT.709 luminance
    grays.push(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
  }

  // Compute difference hash: compare each pixel with its right neighbor
  let hash = 0n;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      hash = hash << 1n;
      if (grays[idx] < grays[idx + 1]) {
        hash |= 1n;
      }
    }
  }

  // Convert to 16-char hex string
  return hash.toString(16).padStart(16, '0');
}

/**
 * Hamming distance between two hex hash strings.
 * Lower = more similar. 0 = identical. < 10 = very similar.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  const big1 = BigInt('0x' + hash1);
  const big2 = BigInt('0x' + hash2);
  let xor = big1 ^ big2;
  let count = 0;
  while (xor > 0n) {
    count++;
    xor &= xor - 1n; // clear lowest set bit
  }
  return count;
}

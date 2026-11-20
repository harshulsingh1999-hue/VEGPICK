import { apiFetch } from './apiClient';

export interface CompressedImageResult {
  base64: string;
  mimeType: 'image/webp' | 'image/jpeg';
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * Compresses any browser File image on-device to WebP (with JPEG fallback)
 * targeting strictly under 200 KB before uploading to the media server.
 */
export async function compressImageUnder200KB(
  file: File,
  maxDimension = 900,
  maxBytes = 195 * 1024
): Promise<CompressedImageResult> {
  const imageUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Failed to decode selected image file.'));
      element.src = imageUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const tryEncode = (mimeType: 'image/webp' | 'image/jpeg', quality: number): string => {
      return canvas.toDataURL(mimeType, quality);
    };

    // Verify browser supports WebP encoding
    const testWebp = tryEncode('image/webp', 0.8);
    const mimeType: 'image/webp' | 'image/jpeg' = testWebp.startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';

    const qualities = [0.82, 0.7, 0.58, 0.45, 0.32];
    let bestDataUrl = testWebp;
    let bestSize = Math.ceil(((bestDataUrl.split(',')[1] || '').length * 3) / 4);

    for (const q of qualities) {
      const encoded = tryEncode(mimeType, q);
      const rawBase64 = encoded.split(',')[1] || '';
      const approxBytes = Math.ceil((rawBase64.length * 3) / 4);
      bestDataUrl = encoded;
      bestSize = approxBytes;
      if (approxBytes <= maxBytes) {
        break;
      }
    }

    const base64Payload = bestDataUrl.split(',')[1] || '';
    return {
      base64: base64Payload,
      mimeType,
      sizeBytes: bestSize,
      width,
      height
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function uploadCompressedMedia(
  file: File,
  prefix: 'proof' | 'product'
): Promise<{ url: string; sizeBytes: number; mimeType: string }> {
  const compressed = await compressImageUnder200KB(file);
  const response = await apiFetch('/api/media/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base64: compressed.base64,
      mimeType: compressed.mimeType,
      prefix
    })
  }, 10_000);

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(
      typeof errBody.error === 'string' ? errBody.error : 'Image upload failed'
    );
  }

  return (await response.json()) as {
    url: string;
    sizeBytes: number;
    mimeType: string;
  };
}

/**
 * Computes great-circle distance in meters between two WGS84 coordinates
 * to throttle GPS writes (10s or 30m movement).
 */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

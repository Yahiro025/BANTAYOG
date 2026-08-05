// Anonymous Photo Store
// Uploads JPEG photo receipts to Supabase Storage without linking
// to user identity. Used by merchants to photograph purchased items
// for the AI vision categorization pipeline.
// FE2 ownership — BE1 reviews Storage RLS policies

export interface UploadResult {
  // Storage path of the uploaded file
  path: string;
  // Public URL to access the uploaded file
  url: string;
}

// Upload a photo receipt blob to the 'photo-receipts' Supabase Storage bucket.
// The upload is anonymous — no user identity is attached.
export async function uploadPhotoReceipt(
  _blob: Blob,
  _metadata?: Record<string, string>,
): Promise<UploadResult> {
  // TODO: implement with @supabase/storage-js
  throw new Error("Not implemented — T-1.9 placeholder");
}

// Convert ImageData or canvas content to a JPEG blob.
export function createPhotoBlob(
  _source: ImageData | HTMLCanvasElement,
  _quality?: number,
): Blob {
  // TODO: implement canvas.toBlob conversion
  throw new Error("Not implemented — T-1.9 placeholder");
}

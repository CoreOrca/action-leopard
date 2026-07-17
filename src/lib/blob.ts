import { put } from "@vercel/blob";

/**
 * Copy a remote file (e.g. a fal.media output URL) into our Vercel Blob store
 * so the app owns the asset at a stable URL. Returns the blob URL.
 */
export async function copyToBlob(
  remoteUrl: string,
  pathname: string
): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${remoteUrl}: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const blob = await put(pathname, res.body!, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return blob.url;
}

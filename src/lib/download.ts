"use client";

function filenameFrom(url: string, fallback: string): string {
  const last = url.split("/").pop()?.split("?")[0];
  return last && last.includes(".") ? last : fallback;
}

/**
 * Spread onto an <img> to make it draggable straight to the desktop/Finder
 * (Chromium's DownloadURL transfer) as well as into other apps via the URL.
 */
export function desktopDragProps(url: string, filename?: string) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const name = filename ?? filenameFrom(url, "frame.png");
      const mime = name.endsWith(".mp4")
        ? "video/mp4"
        : name.endsWith(".jpg") || name.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png";
      e.dataTransfer.setData("DownloadURL", `${mime}:${name}:${url}`);
      e.dataTransfer.setData("text/uri-list", url);
    },
  };
}

/** Force a real download (cross-origin `download` attributes are ignored). */
export async function downloadAsset(
  url: string,
  filename?: string
): Promise<void> {
  const name = filename ?? filenameFrom(url, "download.png");
  const res = await fetch(url);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

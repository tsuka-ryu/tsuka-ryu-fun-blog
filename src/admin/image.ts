// 画像のアップロード前の変換。ブラウザで WebP に変換し、幅を揃えてから送る
// （サーバーで画像を処理すると、Workers の CPU 時間を使うため）。

export const MAX_IMAGE_WIDTH = 1600;
const WEBP_QUALITY = 0.85;

/** 縮小後の寸法。拡大はしない。 */
export function fitWidth(width: number, height: number, maxWidth = MAX_IMAGE_WIDTH) {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

/**
 * アップロードする形にする。アニメーション GIF は変換すると動かなくなるので、そのまま送る。
 * それ以外は、幅を `MAX_IMAGE_WIDTH` に収めて WebP にする。変換できないときは、元のファイルを送る。
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (file.type === "image/gif" || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWidth(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
  } catch {
    return file;
  }
}

export type UploadResult = { ok: true; url: string } | { ok: false; message: string };

const UPLOAD_ERRORS: Record<string, string> = {
  empty: "画像が空です",
  too_large: "画像が大きすぎます（8MB まで）",
  unsupported: "対応していない形式です（PNG / JPEG / GIF / WebP）",
};

export async function uploadImage(file: Blob, slug: string): Promise<UploadResult> {
  const body = await prepareImage(file);
  const response = await fetch(`/api/admin/assets?post=${encodeURIComponent(slug)}`, {
    method: "POST",
    body,
  });
  const json = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (response.ok && json.url) return { ok: true, url: json.url };
  return {
    ok: false,
    message: UPLOAD_ERRORS[json.error ?? ""] ?? `アップロードに失敗しました（${response.status}）`,
  };
}

/** Markdown に挿入する画像の記法。 */
export function imageMarkdown(url: string, alt = ""): string {
  return `![${alt.replace(/[[\]]/g, "")}](${url})`;
}

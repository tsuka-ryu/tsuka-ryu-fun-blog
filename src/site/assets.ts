// 画像のアップロード（管理画面 → R2）の検証とキーの採番。I/O は持たない。

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageType = "image/webp" | "image/png" | "image/jpeg" | "image/gif";

const EXTENSIONS: Record<ImageType, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

/**
 * 先頭のバイト列（マジックナンバー）から画像の種類を判定する。申告された Content-Type は信用しない。
 * SVG は、中にスクリプトを書けるので受け付けない。
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  // WebP は `RIFF` + 4 バイトのサイズ + `WEBP`。
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type ImageCheck =
  | { ok: true; type: ImageType }
  | { ok: false; reason: "empty" | "too_large" | "unsupported" };

export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  const type = sniffImageType(bytes);
  return type ? { ok: true, type } : { ok: false, reason: "unsupported" };
}

/** 推測されない、サーバーが決めるキー（`uploads/2026/10/<ランダム>.webp`）。ファイル名はユーザーの入力から使わない。 */
export function newAssetKey(type: ImageType, now: Date, randomHex: string): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `uploads/${yyyy}/${mm}/${randomHex}.${EXTENSIONS[type]}`;
}

export const ASSET_KEY_PATTERN = /^uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.(?:webp|png|jpg|gif)$/;

export function randomHex(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

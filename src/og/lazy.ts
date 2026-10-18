import type { OgCardProps } from "#og/OgCard.js";

// OG 画像の描画は、WASM とフォント（約 5MB）を読み込む重い処理なので、必要になるまで読み込まない。
export const renderOgLazily = async (input: OgCardProps): Promise<Uint8Array> =>
  (await import("#og/render.js")).renderOgPng(input);

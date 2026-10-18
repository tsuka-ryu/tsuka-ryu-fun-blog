import fontData from "#og/fonts/NotoSansJP-Bold.bin";
import { OgCard, type OgCardProps } from "#og/OgCard.js";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import init, { Renderer } from "@takumi-rs/wasm";
import wasmModule from "@takumi-rs/wasm/auto";

// OG 画像（1200×630 の PNG）の描画。WASM 版の Takumi を Worker の中で動かす（ネイティブ版は Workers で動かない）。
// 重い処理なので、読者のリクエストでは動かさず、公開時に 1 回だけ行う（動的 import で、必要なときだけ読み込む）。
// 絵文字（現行は twemoji を CDN から取得していた）は扱わない。記事のタイトルに絵文字を使わない前提。

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

let renderer: Promise<Renderer> | undefined;

function getRenderer(): Promise<Renderer> {
  // WASM の読み込みとレンダラーの作成は、Worker のインスタンスごとに 1 回だけ。
  renderer ??= (async () => {
    await init({ module_or_path: wasmModule });
    return new Renderer();
  })();
  return renderer;
}

export async function renderOgPng(input: OgCardProps): Promise<Uint8Array> {
  const instance = await getRenderer();
  const { node, stylesheets } = await fromJsx(<OgCard {...input} />);
  // `fonts` を渡すと既定のフォントは使われず、同梱の Noto Sans JP（日本語と英数字を含む）だけになる。
  return instance.render(node, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    format: "png",
    stylesheets,
    fonts: [new Uint8Array(fontData)],
  });
}

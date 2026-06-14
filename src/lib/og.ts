import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { SITE_TITLE } from "#constants.js";
import { getAllPosts } from "#content.js";
import { formatDate } from "#lib/time.js";
import { OgCard } from "#og/OgCard.js";
import { render } from "takumi-js";

// ビルド時の Open Graph 画像生成。記事ごとに 1200×630 の PNG を Takumi（Rust、
// ヘッドレスブラウザ不要）で描画し、<outDir>/og/<slug>.png に書き出す。各記事の
// <Seo> が og:image でこれを参照する。build entry（src/app/build.ts）でのみ実行
// されるため、Takumi も同梱フォントもクライアントには届かない。

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Takumi の render は Rust 側で CPU バウンドなため、全記事を一度に並列レンダリング
// すると CPU / メモリがスパイクする。同時実行数をこの件数ずつのバッチに制限する。
const OG_CONCURRENCY = 4;

// 同梱の日本語フォント（Bold）。Takumi の既定フォントは CJK グリフを持たない。
// vite build 時の cwd であるプロジェクトルートから解決する。
const FONT_PATH = path.join(process.cwd(), "src/og/fonts/NotoSansJP-Bold.ttf");

// 全記事の OG 画像を描画して <outDir>/og/ に書き出す。
export async function generateOgImages(outDir: string): Promise<void> {
  const posts = getAllPosts();
  if (posts.length === 0) return;

  const fontData = new Uint8Array(await readFile(FONT_PATH));
  const ogDir = path.join(outDir, "og");
  await mkdir(ogDir, { recursive: true });

  // 絵文字（emoji: "twemoji"）は SVG を CDN から取得して描画する。全記事で同じ
  // 絵文字を使い回しても再取得しないよう、フェッチ結果のキャッシュを共有する。
  const resourceCache = new Map<string, ArrayBuffer>();

  // OG_CONCURRENCY 件ずつのバッチで描画し、同時実行数を抑える。
  for (let i = 0; i < posts.length; i += OG_CONCURRENCY) {
    const batch = posts.slice(i, i + OG_CONCURRENCY);
    await Promise.all(
      batch.map(async (post) => {
        const meta = [...(post.frontmatter.tags ?? []), formatDate(post.frontmatter.date)].join(
          "  ·  ",
        );

        // fonts を渡すと Takumi は既定フォントを読まず Noto Sans JP のみになる
        // （Latin/英数字は同フォントに含まれる）。絵文字はフォントではなく
        // emoji provider 経由で、twemoji の SVG をビルド時に CDN 取得して描画する。
        const png = await render(
          OgCard({ siteName: SITE_TITLE, title: post.frontmatter.title, meta }),
          {
            width: OG_WIDTH,
            height: OG_HEIGHT,
            format: "png",
            fonts: [fontData],
            emoji: "twemoji",
            resourcesOptions: { cache: resourceCache },
          },
        );

        await writeFile(path.join(ogDir, `${post.slug}.png`), png);
      }),
    );
  }
}

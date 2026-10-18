import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { startPreview, type Preview } from "../scripts/lib/preview.ts";
import { pathsFromBaselines } from "./baseline-urls.ts";

// VRT の対象のサイト（Void でビルドした本番の出力）を、`vite preview` で起動する。
// 先に `pnpm build` しておくこと。テストが終わったら止める。
//
// 公開ページは R2 のスナップショットを読むので、毎回まっさらなローカル状態（D1 / R2）を用意して、
// `content/posts/*.md` を管理 API で取り込んでから撮る（起動の仕組みは scripts/lib/preview.ts）。
// 開発中のローカル状態（`.void/`）には触れず、`vrt/.state/` を使う（消してよい）。

export const PREVIEW_PORT = 4399;
const root = path.resolve(import.meta.dirname, "..");
const stateDir = path.join(import.meta.dirname, ".state");
const baselineDir = path.join(import.meta.dirname, "__screenshots__/site.browser.test.ts");

let preview: Preview | undefined;
let starting: Promise<void> | undefined;

/**
 * 移行前（FUNSTACK）に撮ったページの URL が、新しい環境でも 200 で返り、sitemap にも載っていることを確かめる
 * （画像の比較より前に、ページが消えていないことを見つける）。
 */
async function verifyBaselineUrls(origin: string): Promise<void> {
  const expected = pathsFromBaselines(readdirSync(baselineDir));
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  const problems: string[] = [];
  for (const urlPath of expected) {
    const response = await fetch(`${origin}${urlPath}`);
    if (response.status !== 200) problems.push(`${urlPath}: ${response.status}`);
    else if (!sitemap.includes(`<loc>${new URL(urlPath, "https://tsuka-ryu.dev").href}</loc>`)) {
      problems.push(`${urlPath}: sitemap.xml にありません`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`移行前に存在した URL が、新しい環境で見つかりません:\n${problems.join("\n")}`);
  }
}

/**
 * Vitest は、ブラウザモードの起動の途中で `setup` を 2 回呼ぶことがある（同じプロセスで数秒おき）。
 * 2 回目が状態を消してサーバーを壊さないよう、最初の起動の結果を使い回す。
 */
export function setup(): Promise<void> {
  starting ??= (async () => {
    preview = await startPreview({
      root,
      port: PREVIEW_PORT,
      stateDir,
      logFile: path.join(import.meta.dirname, ".vitest/preview.log"),
    });
    try {
      await verifyBaselineUrls(preview.origin);
    } catch (error) {
      // setup が失敗すると teardown は呼ばれないので、ここで止めないとポートを掴んだまま残る。
      preview.stop();
      throw error;
    }
  })().catch((error: unknown) => {
    starting = undefined;
    throw error;
  });
  return starting;
}

export async function teardown() {
  starting = undefined;
  preview?.stop();
  preview = undefined;
  rmSync(stateDir, { recursive: true, force: true });
}

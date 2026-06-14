import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildEntryFunction } from "@funstack/static/server";
import { buildRssFeed, buildSitemap } from "#lib/feed.js";
import { buildSearchIndexJson, buildSearchRuntimeJs } from "#lib/search.js";
import { generateOgImages } from "#lib/og.js";

// カスタム build entry。既定の静的ビルド（build()）を走らせつつ、生成された HTML の
// 隣に追加成果物を並列で書き出す: feed.xml(RSS) / sitemap.xml / 検索インデックス +
// クライアントランタイム / 記事ごとの OG 画像。build() と並列に走らせて
// クリティカルパスから外す。
export default (async ({ build, outDir }) => {
  await Promise.all([
    build(),
    writeFile(path.join(outDir, "feed.xml"), buildRssFeed()),
    writeFile(path.join(outDir, "sitemap.xml"), buildSitemap()),
    writeFile(path.join(outDir, "search-index.json"), buildSearchIndexJson()),
    writeFile(path.join(outDir, "search.js"), buildSearchRuntimeJs()),
    generateOgImages(outDir),
  ]);
}) satisfies BuildEntryFunction;

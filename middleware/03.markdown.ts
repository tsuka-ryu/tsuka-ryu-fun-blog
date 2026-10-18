import { r2Store } from "#site/r2-store.js";
import { readPostMarkdown } from "#site/read.js";
import { defineMiddleware } from "void";

// `/posts/<slug>.md`: 公開時に R2 に保存した原文（frontmatter 付き）をそのまま返す。
// 下書きや取り下げた記事は R2 にないので、404 になる。
// （`routes/posts/[slug].md.ts` のような、ファイル名の途中にパラメータを置くルートは Void が展開しないので、
// ミドルウェアで処理する。）
const MARKDOWN_PATH = /^\/posts\/([^/]+)\.md$/;

export default defineMiddleware(async (c, next) => {
  const slug = MARKDOWN_PATH.exec(new URL(c.req.url).pathname)?.[1];
  if (slug === undefined || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();

  const markdown = await readPostMarkdown(r2Store, slug);
  if (markdown === null) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(c.req.method === "HEAD" ? null : markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "x-content-type-options": "nosniff",
      // 公開・更新の直後に反映されるよう、ブラウザや中継のキャッシュは短くする。
      "cache-control": "public, max-age=60",
    },
  });
});

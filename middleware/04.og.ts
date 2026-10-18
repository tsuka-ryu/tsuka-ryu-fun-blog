import { renderOgLazily } from "#og/lazy.js";
import { ogKey } from "#site/keys.js";
import { writeOgImage } from "#site/og-image.js";
import { r2Store } from "#site/r2-store.js";
import { readPost } from "#site/read.js";
import { defineMiddleware } from "void";

// `/og/<slug>.png`: 公開時に R2 に置いた OG 画像（SNS のカード）を返す。
// 公開時に作れなかった記事（描画の失敗や、画像を足す前に公開した記事）の取りこぼしは、最初のアクセスで描画して
// R2 に置き、以降はそれを返す。公開されていない記事は、R2 に記事がないので 404。
// （ファイル名の途中にパラメータを置くルートは Void が展開しないので、ミドルウェアで処理する。）
const OG_PATH = /^\/og\/([^/]+)\.png$/;

const HEADERS = {
  "content-type": "image/png",
  // 画像は、記事を更新すると作り直される（URL は同じ）ので、ブラウザや中継のキャッシュは短めにする。
  "cache-control": "public, max-age=3600",
};

export default defineMiddleware(async (c, next) => {
  const slug = OG_PATH.exec(new URL(c.req.url).pathname)?.[1];
  if (slug === undefined || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();

  let png = await r2Store.getBytes(ogKey(slug));
  if (!png) {
    const post = await readPost(r2Store, slug);
    if (!post) return new Response("Not Found", { status: 404 });
    const error = await writeOgImage(
      { store: r2Store, renderOg: renderOgLazily },
      slug,
      post.frontmatter,
    );
    if (error) return new Response("OG image unavailable", { status: 404 });
    png = await r2Store.getBytes(ogKey(slug));
    if (!png) return new Response("Not Found", { status: 404 });
  }
  return new Response(c.req.method === "HEAD" ? null : (png as Uint8Array<ArrayBuffer>), {
    headers: HEADERS,
  });
});

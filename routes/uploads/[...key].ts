import { ASSET_KEY_PATTERN } from "#site/assets.js";
import { defineHandler } from "void";
import { storage } from "void/storage";

// GET /uploads/<年>/<月>/<ランダム>.<拡張子>  アップロードした画像を R2 から返す（公開側。D1 には触れない）。
// キーはサーバーが決めた形（`ASSET_KEY_PATTERN`）だけを通す。キーは推測できず、中身が変わらないので長期キャッシュする。
export const GET = defineHandler(async (c) => {
  const key = `uploads/${c.req.param("key") ?? ""}`;
  if (!ASSET_KEY_PATTERN.test(key)) return c.notFound();
  const object = await storage.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  // 画像以外として解釈させない。
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});

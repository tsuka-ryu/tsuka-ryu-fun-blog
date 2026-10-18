import { publishDeps, requireAdmin } from "#site/admin.js";
import { checkImage, newAssetKey, randomHex } from "#site/assets.js";
import { getPostBySlug } from "#site/posts.js";
import { defineHandler } from "void";
import { storage } from "void/storage";

import { assets } from "../../../db/schema.ts";

// POST /api/admin/assets?post=<slug>  画像のバイト列をそのまま送る。保存先のキーはサーバーが決めて、URL を返す。
// 種類は、申告された Content-Type ではなく中身から判定する（SVG などは断る）。
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const checked = checkImage(bytes);
  if (!checked.ok) {
    return c.json({ error: checked.reason }, checked.reason === "too_large" ? 413 : 400);
  }

  const deps = publishDeps();
  const slug = c.req.query("post");
  const post = slug ? await getPostBySlug(deps.db, slug) : undefined;
  const key = newAssetKey(checked.type, deps.now(), randomHex());
  await storage.put(key, bytes, { httpMetadata: { contentType: checked.type } });
  await deps.db.insert(assets).values({
    r2Key: key,
    contentType: checked.type,
    size: bytes.byteLength,
    postId: post?.id ?? null,
  });
  return c.json({ url: `/${key}`, key });
});

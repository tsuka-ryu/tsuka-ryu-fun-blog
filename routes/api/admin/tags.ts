import { publishDeps, requireAdmin } from "#site/admin.js";
import { listTags } from "#site/posts.js";
import { defineHandler } from "void";

// GET /api/admin/tags  タグ入力の候補（名前・記事数）。表記ゆれの確認にも使う
export const GET = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const rows = await listTags(publishDeps().db);
  return c.json({ tags: rows.map((row) => ({ ...row, count: Number(row.count) })) });
});

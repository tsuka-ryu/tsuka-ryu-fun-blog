import { publishDeps, requireAdmin } from "#site/admin.js";
import { renameTag } from "#site/publish.js";
import { defineHandler } from "void";

// POST /api/admin/tags/rename  { from, to }  タグ名を一括で変更する（すでにあるタグなら統合される）
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  if (typeof body?.from !== "string" || typeof body.to !== "string" || !body.to.trim()) {
    return c.json({ error: "from と to（空でない文字列）が必要です" }, 400);
  }
  return c.json(await renameTag(publishDeps(), body.from, body.to));
});

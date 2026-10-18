import { publishDeps, requireAdmin } from "#site/admin.js";
import { publishPost } from "#site/publish.js";
import { defineHandler } from "void";

// POST /api/admin/posts/:slug/publish  下書きを検証して公開する（検証に失敗したら 422 とエラー一覧）
export const POST = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const result = await publishPost(publishDeps(), c.req.param("slug") ?? "");
  if (result.ok) return c.json(result);
  return c.json(result, result.reason === "invalid" ? 422 : 404);
});

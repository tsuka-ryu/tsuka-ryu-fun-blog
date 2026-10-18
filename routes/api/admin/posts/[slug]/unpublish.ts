import { publishDeps, requireAdmin } from "#site/admin.js";
import { unpublishPost } from "#site/publish.js";
import { defineHandler } from "void";

// POST /api/admin/posts/:slug/unpublish  公開を取り下げる（下書きと履歴は残る）
export const POST = defineHandler(async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const result = await unpublishPost(publishDeps(), c.req.param("slug") ?? "");
  return c.json(result, result.ok ? 200 : 404);
});

import { publishDeps, requireAdmin } from "#site/admin.js";
import { getPostBySlug, listRevisions } from "#site/posts.js";
import { defineHandler } from "void";

// GET /api/admin/posts/:slug/revisions  履歴の一覧（本文は引かない。新しい順）
export const GET = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const { db } = publishDeps();
  const post = await getPostBySlug(db, c.req.param("slug") ?? "");
  if (!post) return c.json({ error: "not_found" }, 404);
  return c.json({ revisions: await listRevisions(db, post.id) });
});

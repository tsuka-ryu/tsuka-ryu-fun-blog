import { publishDeps, requireAdmin } from "#site/admin.js";
import { listPosts } from "#site/posts.js";
import { defineHandler } from "void";

const PAGE_SIZE = 20;

// GET /api/admin/posts?page=1  記事の一覧（更新の新しい順。本文は引かない）
export const GET = defineHandler(async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  // 次のページがあるかを知るために、1 件多く引く。
  const rows = await listPosts(publishDeps().db, {
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  return c.json({ page, posts: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE });
});

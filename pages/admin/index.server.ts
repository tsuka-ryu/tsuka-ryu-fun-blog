import { seoHead } from "#lib/seo.js";
import { redirectUnlessAdmin } from "#site/admin-page.js";
import { publishDeps } from "#site/admin.js";
import { listPosts } from "#site/posts.js";
import { defineHandler, defineHead } from "void";

const PAGE_SIZE = 20;

export const loader = defineHandler(async (c) => {
  const denied = await redirectUnlessAdmin(c);
  if (denied) return denied;

  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  // 次のページがあるかを知るために、1 件多く引く（一覧は本文を引かない）。
  const rows = await listPosts(publishDeps().db, {
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  return { page, posts: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
});

export const head = defineHead(() => seoHead({ title: "記事の管理", noindex: true }));

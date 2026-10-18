import { seoHead } from "#lib/seo.js";
import { redirectUnlessAdmin } from "#site/admin-page.js";
import { publishDeps } from "#site/admin.js";
import { listTags } from "#site/posts.js";
import { defineHandler, defineHead } from "void";

export const loader = defineHandler(async (c) => {
  const denied = await redirectUnlessAdmin(c);
  if (denied) return denied;

  const rows = await listTags(publishDeps().db);
  return { tags: rows.map((row) => ({ ...row, count: Number(row.count) })) };
});

export const head = defineHead(() => seoHead({ title: "タグの管理", noindex: true }));

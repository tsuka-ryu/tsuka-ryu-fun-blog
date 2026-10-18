import { seoHead } from "#lib/seo.js";
import { dateInTokyoToday } from "#lib/time.js";
import { redirectUnlessAdmin } from "#site/admin-page.js";
import { publishDeps } from "#site/admin.js";
import { getPostDetail } from "#site/posts.js";
import { defineHandler, defineHead } from "void";

export const loader = defineHandler(async (c) => {
  const denied = await redirectUnlessAdmin(c);
  if (denied) return denied;

  const post = await getPostDetail(publishDeps().db, c.req.param("slug") ?? "");
  if (!post) c.header("x-not-found", "1");
  return { post, today: dateInTokyoToday() };
});

export const head = defineHead(() => seoHead({ title: "記事の編集", noindex: true }));

import { seoHead } from "#lib/seo.js";
import { dateInTokyoToday } from "#lib/time.js";
import { redirectUnlessAdmin } from "#site/admin-page.js";
import { defineHandler, defineHead } from "void";

export const loader = defineHandler(async (c) => {
  const denied = await redirectUnlessAdmin(c);
  if (denied) return denied;
  return { today: dateInTokyoToday() };
});

export const head = defineHead(() => seoHead({ title: "新規作成", noindex: true }));

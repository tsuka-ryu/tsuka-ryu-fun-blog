import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

// どのルートにも当てはまらない URL。ステータスは 404 で、検索エンジンには載せない。
export const loader = defineHandler((c) => {
  c.header("x-not-found", "1");
  return {};
});

export const head = defineHead(() => seoHead({ title: "ページが見つかりません", noindex: true }));

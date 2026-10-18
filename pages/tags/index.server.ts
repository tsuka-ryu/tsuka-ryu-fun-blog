import { getAllTags, type TagInfo } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

export type Props = Readonly<{ tags: TagInfo[] }>;

export const loader = defineHandler<Props>(() => ({ tags: getAllTags() }));

export const head = defineHead<Props>(() =>
  seoHead({
    title: "タグ一覧",
    description: "記事のタグ一覧。タグをクリックすると、そのタグが付いた記事を絞り込めます。",
    path: "/tags",
  }),
);

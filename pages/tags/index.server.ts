import { type TagInfo } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { r2Store } from "#site/r2-store.js";
import { readIndex } from "#site/read.js";
import { defineHandler, defineHead } from "void";

export const revalidate = 60 * 60 * 24 * 30;

export type Props = Readonly<{ tags: TagInfo[] }>;

export const loader = defineHandler<Props>(async () => ({
  tags: (await readIndex(r2Store)).tags,
}));

export const head = defineHead<Props>(() =>
  seoHead({
    title: "タグ一覧",
    description: "記事のタグ一覧。タグをクリックすると、そのタグが付いた記事を絞り込めます。",
    path: "/tags",
  }),
);

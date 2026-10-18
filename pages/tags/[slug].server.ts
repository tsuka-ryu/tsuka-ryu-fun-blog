import { getTagBySlug, type PostSummary } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { r2Store } from "#site/r2-store.js";
import { readIndex } from "#site/read.js";
import { defineHandler, defineHead } from "void";

export const revalidate = 60 * 60 * 24 * 30;

// 存在しないタグは、404 のステータスで、tag を null にして返す。
export type Props = Readonly<{ slug: string; tag: string | null; posts: PostSummary[] }>;

export const loader = defineHandler<Props>(async (c) => {
  const slug = c.req.param("slug") ?? "";
  const result = getTagBySlug(await readIndex(r2Store), slug);
  if (!result) c.header("x-not-found", "1");
  return { slug, tag: result?.tag ?? null, posts: result?.posts ?? [] };
});

export const head = defineHead<Props>((_, { slug, tag, posts }) =>
  tag === null
    ? seoHead({ title: "ページが見つかりません", noindex: true })
    : seoHead({
        title: `タグ: ${tag}`,
        description: `「${tag}」タグが付いた記事一覧（${posts.length} 件）。`,
        path: `/tags/${slug}`,
      }),
);

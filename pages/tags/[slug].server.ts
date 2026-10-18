import { getTagBySlug, summarize, type PostSummary } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

// 存在しないタグは、404 のステータスで、tag を null にして返す。
export type Props = Readonly<{ slug: string; tag: string | null; posts: PostSummary[] }>;

export const loader = defineHandler<Props>((c) => {
  const slug = c.req.param("slug") ?? "";
  const result = getTagBySlug(slug);
  if (!result) c.header("x-not-found", "1");
  return { slug, tag: result?.tag ?? null, posts: result?.posts.map(summarize) ?? [] };
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

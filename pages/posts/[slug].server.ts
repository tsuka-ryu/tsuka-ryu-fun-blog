import { getPostWithHighlight, type Post } from "#content.js";
import { seoHead } from "#lib/seo.js";
import { defineHandler, defineHead } from "void";

// 存在しない記事は、404 のステータスで、post を null にして返す（ページが 404 の本文を出す）。
export type Props = Readonly<{ post: Post | null }>;

export const loader = defineHandler<Props>(async (c) => {
  const post = await getPostWithHighlight(c.req.param("slug") ?? "");
  if (!post) c.header("x-not-found", "1");
  return { post: post ?? null };
});

export const head = defineHead<Props>((_, { post }) =>
  !post
    ? seoHead({ title: "ページが見つかりません", noindex: true })
    : seoHead({
        title: post.frontmatter.title,
        description: post.frontmatter.description,
        path: `/posts/${post.slug}`,
        image: `/og/${post.slug}.png`,
        type: "article",
      }),
);

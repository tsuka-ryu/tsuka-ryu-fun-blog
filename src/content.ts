import { tagSlug } from "#lib/tag-slug.js";

import type { TocEntry } from "#lib/toc.js";
import type { MdastNode } from "#markdown/types.js";

// 公開側が扱う記事のデータ形式と、その集計。I/O は持たない（R2 や D1 からの読み書きは #site/ にある）。

/** 記事の frontmatter の想定形。 */
export interface PostFrontmatter {
  title: string;
  date: string;
  description?: string;
  tags?: string[];
}

/**
 * 公開した記事 1 本分のスナップショット（R2 の `published/posts/<slug>.json` の中身）。
 * 公開時に、パース・検証・コードのハイライトまで済ませてあるので、公開ページはこれを読むだけで描画できる。
 */
export interface Post {
  slug: string;
  frontmatter: PostFrontmatter;
  /** パース済みの AST（ルートノード）。<Markdown> が描画する。コードのハイライトは埋め込み済み。 */
  mdast: MdastNode;
  /** 本文から抽出した目次（h2〜h3）。 */
  toc: TocEntry[];
  /** frontmatter を除いた本文 Markdown。 */
  body: string;
}

export { tagSlug };

/** 一覧に出す分だけ（本文の AST を含まない）。ページの props に載せる。 */
export type PostSummary = Pick<Post, "slug" | "frontmatter">;

export function summarize(post: Post): PostSummary {
  return { slug: post.slug, frontmatter: post.frontmatter };
}

/** 1 つのタグについて全記事を横断して集計した情報。 */
export interface TagInfo {
  /** 表示ラベル（frontmatter に書かれたまま）。 */
  tag: string;
  /** `/tags/<slug>` で使う URL スラッグ。 */
  slug: string;
  /** そのタグが付いた記事数。 */
  count: number;
}

/**
 * 公開済み記事の一覧（R2 の `published/index.json`）。公開のたびに作り直す。
 * トップ・タグ一覧・タグ詳細は、これ 1 つを読めば描画できる。
 */
export interface SiteIndex {
  /** 新しい順。 */
  posts: PostSummary[];
  /** 利用数の多い順（同数はアルファベット順）。 */
  tags: TagInfo[];
}

/** 公開済みの記事から、一覧を作る。 */
export function buildSiteIndex(posts: readonly PostSummary[]): SiteIndex {
  // 新しい順。同じ日付は slug の降順にして、並びを決まったものにする。
  const sorted = [...posts].sort(
    (a, b) =>
      (a.frontmatter.date < b.frontmatter.date
        ? 1
        : a.frontmatter.date > b.frontmatter.date
          ? -1
          : 0) || (a.slug < b.slug ? 1 : -1),
  );

  // 同じスラッグに畳まれる異なる表示ラベルは、そのスラッグ配下にまとめる（最初に出たラベルを採用）。
  const tagMap = new Map<string, TagInfo>();
  for (const post of sorted) {
    const seen = new Set<string>();
    for (const tag of post.frontmatter.tags ?? []) {
      const slug = tagSlug(tag);
      // 1 本の記事が、同じスラッグのタグを 2 回数えないようにする。
      if (seen.has(slug)) continue;
      seen.add(slug);
      const entry = tagMap.get(slug);
      if (entry) entry.count += 1;
      else tagMap.set(slug, { tag, slug, count: 1 });
    }
  }
  const tags = [...tagMap.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { posts: sorted, tags };
}

/** タグスラッグの表示ラベルと記事一覧。未知のスラッグなら undefined。 */
export function getTagBySlug(
  index: SiteIndex,
  slug: string,
): { tag: string; posts: PostSummary[] } | undefined {
  const info = index.tags.find((t) => t.slug === slug);
  if (!info) return undefined;
  const posts = index.posts.filter((post) =>
    (post.frontmatter.tags ?? []).some((tag) => tagSlug(tag) === slug),
  );
  return { tag: info.tag, posts };
}

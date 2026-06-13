import { parse, prepareSource } from "@ox-content/napi";
import type { MdastNode } from "#markdown/types.js";
import { extractToc, slugify, type TocEntry } from "#lib/toc.js";

/** content/posts/*.md 各ファイル冒頭の frontmatter の想定形。 */
export interface PostFrontmatter {
  title: string;
  date: string;
  description?: string;
  tags?: string[];
}

export interface Post {
  slug: string;
  frontmatter: PostFrontmatter;
  /** パース済み mdast ツリー（ルートノード）。<Markdown> が React に描画する。 */
  mdast: MdastNode;
  /** 本文から抽出した目次（h2〜h3）。 */
  toc: TocEntry[];
}

// 全 Markdown ファイルをビルド時に生文字列として読み込む。これはサーバー
// （ビルド）環境でのみ実行されるため、ネイティブの ox-content モジュールが
// クライアントバンドルに混入することはない。
const rawPosts = import.meta.glob<string>("../content/posts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function slugFromPath(path: string): string {
  return path.replace(/^.*\/(.+)\.md$/, "$1");
}

// content.ts の中心。全記事をビルド時にパースして Post[] に変換し、
// 新しい順に並べた配列を以降の取得関数へ供給する。
const posts: Post[] = Object.entries(rawPosts)
  .map(([path, raw]): Post => {
    // YAML frontmatter を Rust 側で分離・パースし、残りの Markdown 本文を
    // mdast ツリー（JSON）にパースする。
    const prepared = prepareSource(raw, { frontmatter: true });
    const parsed = parse(prepared.content, {
      gfm: true,
      tables: true,
      taskLists: true,
      strikethrough: true,
      autolinks: true,
    });

    if (parsed.errors.length > 0) {
      console.warn(`[content] errors while parsing ${path}:`, parsed.errors);
    }

    const mdast = JSON.parse(parsed.ast) as MdastNode;
    // 見出しノードにアンカー id を付与（mdast をその場で書き換え）し、TOC を返す。
    const toc = extractToc(mdast);

    return {
      slug: slugFromPath(path),
      frontmatter: prepared.frontmatter as PostFrontmatter,
      mdast,
      toc,
    };
  })
  // 新しい順。
  .sort((a, b) => (a.frontmatter.date < b.frontmatter.date ? 1 : -1));

export function getAllPosts(): Post[] {
  return posts;
}

export function getPostBySlug(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
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

/** frontmatter のタグを URL スラッグに変換する。 */
export function tagSlug(tag: string): string {
  return slugify(tag);
}

// ビルド時に記事をタグスラッグでグループ化する。同じスラッグに畳まれる
// 異なる表示ラベルは、そのスラッグ配下にまとめる（最初のラベルを採用）。
const tagMap = new Map<string, { tag: string; posts: Post[] }>();
for (const post of posts) {
  for (const tag of post.frontmatter.tags ?? []) {
    const slug = tagSlug(tag);
    const entry = tagMap.get(slug);
    if (entry) {
      entry.posts.push(post);
    } else {
      tagMap.set(slug, { tag, posts: [post] });
    }
  }
}

/** 全タグを利用数の多い順（同数はアルファベット順）で返す。 */
export function getAllTags(): TagInfo[] {
  return [...tagMap.entries()]
    .map(([slug, { tag, posts }]) => ({ tag, slug, count: posts.length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** タグスラッグの表示ラベルと記事一覧。未知のスラッグなら undefined。 */
export function getTagBySlug(
  slug: string,
): { tag: string; posts: Post[] } | undefined {
  return tagMap.get(slug);
}

import { tagSlug } from "#lib/tag-slug.js";
import { extractToc, type TocEntry } from "#lib/toc.js";
import { attachHighlights } from "#markdown/highlight.js";
import { parseDocument, type Diagnostic } from "#markdown/parse/index.js";

import type { MdastNode } from "#markdown/types.js";

/** content/posts/*.md 各ファイル冒頭の frontmatter の想定形。 */
export interface PostFrontmatter {
  title: string;
  date: string;
  description?: string;
  tags?: string[];
  /**
   * true の記事は本番では丸ごと除外する（ルートも生成されず、一覧・タグ・RSS・検索・OGP のどこにも
   * 出てこない）。`pnpm run dev` のときだけ、レビュー用に通常の記事と同じように見える。
   * パース・検証は除外の前に必ず通す。
   */
  draft?: boolean;
}

export interface Post {
  slug: string;
  frontmatter: PostFrontmatter;
  /** パース済みの AST（ルートノード）。<Markdown> が描画する。コードのハイライトは getPostWithHighlight で埋める。 */
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

// 全 Markdown ファイルを、生の文字列として読み込む。
const rawPosts = import.meta.glob<string>("../content/posts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function slugFromPath(path: string): string {
  return path.replace(/^.*\/(.+)\.md$/, "$1");
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((d) => `  [${d.severity}] ${d.ruleId} (${d.line}:${d.column}) ${d.message}`)
    .join("\n");
}

// 全記事を、自作のパーサー（#markdown/parse）で解析して Post[] に変換し、新しい順に並べる。
// 壊れた記事（error の診断がある）は、世に出さないようにここで失敗させる。warning は表示だけ。
const posts: Post[] = Object.entries(rawPosts)
  .map(([path, raw]): Post => {
    const { ast, frontmatter, body, diagnostics } = parseDocument(raw);
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      throw new Error(`[content] ${path} の検証に失敗しました:\n${formatDiagnostics(errors)}`);
    }
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    if (warnings.length > 0) {
      console.warn(`[content] ${path} の警告:\n${formatDiagnostics(warnings)}`);
    }
    // 見出しノードにアンカー id を付与（ast をその場で書き換え）し、目次を返す。
    const toc = extractToc(ast);
    return {
      slug: slugFromPath(path),
      frontmatter: frontmatter as unknown as PostFrontmatter,
      mdast: ast,
      toc,
      body,
    };
  })
  // draft は本番では除外する。解析と検証は上の map() で全記事に対して済んでいるので、公開前でも壊れた記事は
  // 検知できる。`pnpm run dev` のときだけ import.meta.env.DEV が true になり、draft も通常の記事と同じに見える。
  .filter((post) => !post.frontmatter.draft || import.meta.env.DEV)
  // 新しい順。
  .sort((a, b) => (a.frontmatter.date < b.frontmatter.date ? 1 : -1));

/** 1 つのタグについて全記事を横断して集計した情報。 */
export interface TagInfo {
  /** 表示ラベル（frontmatter に書かれたまま）。 */
  tag: string;
  /** `/tags/<slug>` で使う URL スラッグ。 */
  slug: string;
  /** そのタグが付いた記事数。 */
  count: number;
}

export function getAllPosts(): Post[] {
  // 内部配列の参照を渡すと呼び出し側の sort 等で破壊されるためコピーを返す。
  return [...posts];
}

export function getPostBySlug(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}

/** コードのハイライトを埋めた記事を返す（記事ページ用）。埋めるのは初回だけで、結果は使い回す。 */
export async function getPostWithHighlight(slug: string): Promise<Post | undefined> {
  const post = getPostBySlug(slug);
  if (post) await attachHighlights(post.mdast);
  return post;
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
export function getTagBySlug(slug: string): { tag: string; posts: Post[] } | undefined {
  return tagMap.get(slug);
}

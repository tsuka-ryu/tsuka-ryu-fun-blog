import {
  buildSiteIndex,
  summarize,
  type Post,
  type PostFrontmatter,
  type SiteIndex,
} from "#content.js";
import { buildRssFeed, buildSitemap } from "#lib/feed.js";
import { buildSearchIndexJson } from "#lib/search.js";
import { extractToc } from "#lib/toc.js";
import { attachHighlights } from "#markdown/highlight.js";
import { parseDocument, type Diagnostic } from "#markdown/parse/index.js";

// 記事 1 本を公開用のスナップショットにする処理と、公開済みの記事から一覧・feed・sitemap・検索索引を作る処理。
// どちらも純粋（I/O なし）で、サーバー（公開関数）とテストから呼ばれる。

/** 編集中の記事の内容（D1 の `post_revisions` の 1 行に相当）。 */
export interface PostInput {
  slug: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD`。 */
  date: string;
  tags: string[];
  /** frontmatter を含まない本文の Markdown。 */
  body: string;
}

/** YAML の値として、そのまま書いても読み違えられない文字列か。 */
function isPlainScalar(value: string): boolean {
  return (
    /^[^\s"'[\]{}#&*!|>%@`,:?-]/.test(value) &&
    !/[:#]\s|\s$|\n/.test(value) &&
    !/^(true|false|null|~)$/.test(value) &&
    !/^-?\d+(\.\d+)?$/.test(value)
  );
}

function yamlString(value: string): string {
  if (isPlainScalar(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * 記事の内容を、frontmatter 付きの Markdown 原文にする（`/posts/<slug>.md` で配信し、バックアップを兼ねる）。
 * 項目の並びは、既存の記事と同じ（title / description / date / tags）。
 */
export function serializePost(input: Omit<PostInput, "slug">): string {
  const lines = ["---", `title: ${yamlString(input.title)}`];
  if (input.description) lines.push(`description: ${yamlString(input.description)}`);
  lines.push(`date: ${input.date}`);
  if (input.tags.length > 0) {
    lines.push(`tags: [${input.tags.map((tag) => yamlString(tag)).join(", ")}]`);
  }
  lines.push("---", "");
  const body = input.body.endsWith("\n") ? input.body : `${input.body}\n`;
  return `${lines.join("\n")}\n${body}`;
}

/** 版（`post_revisions` の行）のタグ名の配列。 */
export function revisionTags(revision: { tags: string }): string[] {
  return JSON.parse(revision.tags) as string[];
}

export type BuildResult =
  | { ok: true; post: Post; raw: string; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[] };

/**
 * 記事を検証して、公開用のスナップショットにする。`error` の診断が 1 つでもあれば、公開してはいけないので
 * 失敗として返す（例外は投げない）。`warning` は成功に付けて返す。
 */
export async function buildPost(input: PostInput): Promise<BuildResult> {
  const raw = serializePost(input);
  const { ast, frontmatter, body, diagnostics } = parseDocument(raw);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) return { ok: false, errors };

  // 見出しノードにアンカー id を付与（ast をその場で書き換え）し、目次を返す。
  const toc = extractToc(ast);
  await attachHighlights(ast);
  return {
    ok: true,
    raw,
    warnings: diagnostics.filter((d) => d.severity === "warning"),
    post: {
      slug: input.slug,
      frontmatter: frontmatter as unknown as PostFrontmatter,
      mdast: ast,
      toc,
      body,
    },
  };
}

/** 公開中の記事全体から作る、読者向けの集計物。 */
export interface SiteAggregates {
  index: SiteIndex;
  feedXml: string;
  sitemapXml: string;
  searchIndexJson: string;
}

export function buildAggregates(posts: readonly Post[], now: Date): SiteAggregates {
  const index = buildSiteIndex(posts.map(summarize));
  // feed と検索索引も、一覧と同じ順（新しい順）で並べる。
  const order = new Map(index.posts.map((post, i) => [post.slug, i]));
  const sorted = [...posts].sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
  return {
    index,
    feedXml: buildRssFeed(sorted, now),
    sitemapXml: buildSitemap(index),
    searchIndexJson: buildSearchIndexJson(sorted),
  };
}

import {
  lintMarkdown,
  parse,
  prepareSource,
  type JsMarkdownLintDiagnostic,
  type JsMarkdownLintOptions,
} from "@ox-content/napi";
import { transliterate } from "transliteration";
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
  /** frontmatter を除いた本文 Markdown。RSS の全文（content:encoded）生成に使う。 */
  body: string;
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

// link/image の URL に許可するスキーム・形。http(s) / mailto はそのまま、
// 絶対パス(/) ・相対パス(./, ../) ・フラグメント(#) ・拡張子付きの素パスを許す。
// javascript: や data: など、それ以外のスキームは危険として弾く。
const SAFE_URL = /^(https?:|mailto:|tel:|\/|\.\.?\/|#|[\w./-]+$)/i;

// mdast を走査して link/image の URL を検証する。危険な URL を含む記事は
// ビルドを失敗させ、世に出さない（frontmatter / lint 検証と同じ思想）。
// TODO: width/height 必須化。将来 image ノードへ width/height を注入するなら、この走査に
// 相乗りさせる。型必須化を保留している経緯は src/markdown/components.tsx の Image 参照。
function validateUrls(node: MdastNode, path: string): void {
  if (node.type === "link" || node.type === "image") {
    if (!SAFE_URL.test(node.url)) {
      throw new Error(
        `[content] ${path}: 安全でない URL を検出しました（${node.url}）`,
      );
    }
  }
  if ("children" in node) {
    for (const child of node.children) validateUrls(child, path);
  }
}

/** frontmatter の date に要求する形式（YYYY-MM-DD）。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 本文 Markdown の lint 設定。見出し構造や体裁の崩れを検出する。
// これらのルールは warning として報告されるが、本ブログでは壊れた記事を
// 出さない方針のため warning もビルド失敗扱いにする（下の lintPost 参照）。
// spellcheck は日本語で誤検知が多いため無効。
// maxConsecutiveBlankLines はデフォルト ON のため明示せず（u32 専用で false 不可）。
// ただし後述の不具合により lintPost で非致命に降格する。
const LINT_OPTIONS: JsMarkdownLintOptions = {
  rules: {
    duplicateHeadings: true,
    headingIncrement: true,
    repeatedPunctuation: true,
    repeatedWords: true,
    spellcheck: false,
    trailingSpaces: true,
  },
};

// 非致命に降格する lint ルール。max-consecutive-blank-lines はフェンス済み
// コードブロック直後の単独空行を「連続空行」と誤判定する不具合があり、コードを
// 含む記事が正しい Markdown でもビルド不能になる（最小再現: `## A` →
// ```code``` → 空行 → `## B`）。warning 表示のみに留め、ビルドは止めない。
const NON_FATAL_RULES = new Set(["max-consecutive-blank-lines"]);

function formatDiagnostics(diagnostics: JsMarkdownLintDiagnostic[]): string {
  return diagnostics
    .map(
      (d) =>
        `  [${d.severity}] ${d.ruleId} (${d.line}:${d.column}) ${d.message}`,
    )
    .join("\n");
}

// 本文を lint し、error / warning があればビルドを失敗させる。ただし
// NON_FATAL_RULES のルールと info は警告表示のみに留める。
function lintPost(content: string, path: string): void {
  const { diagnostics } = lintMarkdown(content, LINT_OPTIONS);
  const fatal = diagnostics.filter(
    (d) =>
      (d.severity === "error" || d.severity === "warning") &&
      !NON_FATAL_RULES.has(d.ruleId),
  );
  if (fatal.length > 0) {
    throw new Error(
      `[content] ${path} の lint に失敗しました:\n${formatDiagnostics(fatal)}`,
    );
  }
  const warnings = diagnostics.filter((d) => !fatal.includes(d));
  if (warnings.length > 0) {
    console.warn(
      `[content] ${path} の lint 警告:\n${formatDiagnostics(warnings)}`,
    );
  }
}

// frontmatter を検証して PostFrontmatter に確定する。必須項目の欠落や
// date の表記揺れはビルドを失敗させ、壊れた記事が世に出ないようにする。
function assertFrontmatter(fm: unknown, path: string): PostFrontmatter {
  if (typeof fm !== "object" || fm === null) {
    throw new Error(`[content] ${path}: frontmatter がありません`);
  }
  const { title, date } = fm as Record<string, unknown>;
  if (typeof title !== "string" || title.length === 0) {
    throw new Error(`[content] ${path}: frontmatter.title が必要です`);
  }
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) {
    throw new Error(
      `[content] ${path}: frontmatter.date は YYYY-MM-DD 形式で書いてください（実際: ${String(date)}）`,
    );
  }
  return fm as PostFrontmatter;
}

// content.ts の中心。全記事をビルド時にパースして Post[] に変換し、
// 新しい順に並べた配列を以降の取得関数へ供給する。
const posts: Post[] = Object.entries(rawPosts)
  .map(([path, raw]): Post => {
    // YAML frontmatter を Rust 側で分離・パースし、残りの Markdown 本文を
    // mdast ツリー（JSON）にパースする。
    const prepared = prepareSource(raw, { frontmatter: true });
    // frontmatter を除いた本文に対して lint をかける（行番号は本文基準）。
    lintPost(prepared.content, path);
    const parsed = parse(prepared.content, {
      gfm: true,
      tables: true,
      taskLists: true,
      strikethrough: true,
      autolinks: true,
    });

    if (parsed.errors.length > 0) {
      throw new Error(
        `[content] ${path} のパースに失敗しました:\n${JSON.stringify(parsed.errors, null, 2)}`,
      );
    }

    const mdast = JSON.parse(parsed.ast) as MdastNode;
    // link/image の URL を検証し、危険な URL の記事はビルドを止める。
    validateUrls(mdast, path);
    // 見出しノードにアンカー id を付与（mdast をその場で書き換え）し、TOC を返す。
    const toc = extractToc(mdast);

    return {
      slug: slugFromPath(path),
      frontmatter: assertFrontmatter(prepared.frontmatter, path),
      mdast,
      toc,
      body: prepared.content,
    };
  })
  // 新しい順。
  .sort((a, b) => (a.frontmatter.date < b.frontmatter.date ? 1 : -1));

export function getAllPosts(): Post[] {
  // 内部配列の参照を渡すと呼び出し側の sort 等で破壊されるためコピーを返す。
  return [...posts];
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

/**
 * frontmatter のタグを URL スラッグに変換する。
 * transliterate で日本語を romaji 化してから slugify でクリーンアップし、
 * ASCII の URL セーフなスラッグにする（例「RSSフィード」→ rsshuido、
 * 「Next.js」→ nextjs）。見出しのアンカー（extractToc）は日本語を残す方針なので
 * slugify を直接使い、タグだけ transliterate を噛ませてここで分岐する。
 */
export function tagSlug(tag: string): string {
  return slugify(transliterate(tag));
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

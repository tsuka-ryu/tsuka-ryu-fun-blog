import { getAllPosts } from "#content.js";
import {
  buildSearchIndex,
  generateSearchModuleFromOptions,
  type JsSearchDocument,
  type JsSearchRuntimeOptions,
} from "@ox-content/napi";

import type { MdastNode } from "#markdown/types.js";

// ビルド時の検索処理。記事を ox-content の検索ドキュメントへ変換してインデックスを
// 構築し、ox-content が出力する純 JS のクライアントランタイムを生成する。どちらの
// 成果物も build entry（src/app/build.ts）が出力ディレクトリへ書き出し、クライアントの
// SearchBox が /search.js を読み込んで /search-index.json を検索する。ネイティブの
// ox-content モジュールはブラウザに届かない。
//
// 仕組みの全体像（データフロー / ドキュメントのフィールド / 収集ルール）は
// docs/search.md を参照。

// クライアントランタイムがインデックスを取得するパス（静的ファイルとして配信）。
const INDEX_PATH = "/search-index.json";

const SEARCH_OPTIONS: JsSearchRuntimeOptions = {
  enabled: true,
  limit: 8,
  prefix: true,
  placeholder: "記事を検索...",
  hotkey: "/",
};

// mdast ツリーから本文テキスト・見出しテキスト・コードを収集する。
function collectContent(root: MdastNode): {
  body: string;
  headings: string[];
  code: string[];
} {
  const bodyParts: string[] = [];
  const headings: string[] = [];
  const code: string[] = [];

  const textOf = (node: MdastNode): string => {
    if ("value" in node) return node.value;
    if ("children" in node) return node.children.map(textOf).join("");
    return "";
  };

  const walk = (node: MdastNode): void => {
    if (node.type === "code") {
      code.push(node.value);
      return;
    }
    if (node.type === "heading") {
      // 見出しは headings に集約し、本文（body）には含めない（二重計上を避ける）。
      headings.push(textOf(node).trim());
      return;
    }
    if (node.type === "text" || node.type === "inlineCode") {
      bodyParts.push(node.value);
    }
    if ("children" in node) node.children.forEach(walk);
  };

  walk(root);
  return { body: bodyParts.join(" "), headings, code };
}

function searchDocuments(): JsSearchDocument[] {
  return getAllPosts().map((post): JsSearchDocument => {
    const { body, headings, code } = collectContent(post.mdast);
    return {
      id: post.slug,
      title: post.frontmatter.title,
      url: `/posts/${post.slug}`,
      body,
      headings,
      code,
    };
  });
}

// /search-index.json として配るシリアライズ済み検索インデックス（JSON 文字列）。
export function buildSearchIndexJson(): string {
  return buildSearchIndex(searchDocuments());
}

// /search.js として配る、ox-content 生成のクライアント検索ランタイム（ESM ソース）。
export function buildSearchRuntimeJs(): string {
  return generateSearchModuleFromOptions(SEARCH_OPTIONS, INDEX_PATH);
}

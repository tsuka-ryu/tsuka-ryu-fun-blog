import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import type { HighlightedCode, MdastNode } from "#markdown/types.js";

// シンタックスハイライト。描画（components.tsx）とは切り離してある。
//
// コードを色つきのトークンにする処理（このファイル）は、公開時にサーバーで 1 回だけ行い、結果を AST の
// `code.highlight` に埋めて保存する。描画側は、埋まったトークンを並べるだけの同期の処理になる。
// そのため、読者のリクエストでは shiki が動かず、ブラウザのプレビューでも同じ関数を呼べる。
//
// 正規表現エンジンは、WASM を使わない JavaScript 実装（Workers でそのまま動く）。
// 色を直書きせず CSS 変数でライト／ダークの両テーマを出力するので、サイトの prefers-color-scheme
// （styles.css の --shiki-light / --shiki-dark）に追従する。

const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";

// 対応する言語。必要な言語だけを動的 import で読み込む（Worker のバンドルを大きくしないため、
// shiki が持つ全言語ではなく、記事で使うものに絞る）。ここにない言語は、色なしのコードとして描画する。
type LanguageLoader = () => Promise<{ default: LanguageRegistration | LanguageRegistration[] }>;

const LANGUAGES: Record<string, LanguageLoader> = {
  bash: () => import("shiki/langs/bash.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

// 記事での書き方（フェンスの言語名）から、上の正式名への対応。
const ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
};

let highlighterPromise: Promise<HighlighterCore> | undefined;
const loadedLanguages = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

/** コードをハイライトする。未対応・未指定の言語は、色なしのトークンにする。 */
export async function highlightCode(
  code: string,
  lang: string | null | undefined,
): Promise<HighlightedCode> {
  const name = lang ? (ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) : undefined;
  const loader = name ? LANGUAGES[name] : undefined;
  const highlighter = await getHighlighter();
  if (name && loader && !loadedLanguages.has(name)) {
    await highlighter.loadLanguage((await loader()).default);
    loadedLanguages.add(name);
  }
  const { tokens, bg, fg } = highlighter.codeToTokens(code, {
    lang: name && loader ? name : "text",
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
  return {
    lines: tokens.map((line) =>
      line.map((token) => ({
        content: token.content,
        ...(token.htmlStyle ? { htmlStyle: token.htmlStyle as Record<string, string> } : {}),
      })),
    ),
    rootStyle: parseStyle(bg, fg),
  };
}

/** shiki が返す `bg` / `fg`（"light;dark" の形で、CSS 変数の宣言を含む）を、スタイルのオブジェクトにする。 */
function parseStyle(
  bg: string | undefined,
  fg: string | undefined,
): Record<string, string> | undefined {
  const style: Record<string, string> = {};
  for (const declarations of [bg, fg]) {
    if (!declarations) continue;
    for (const decl of declarations.split(";")) {
      const index = decl.indexOf(":");
      if (index === -1) continue;
      const prop = decl.slice(0, index).trim();
      const value = decl.slice(index + 1).trim();
      if (prop.startsWith("--")) style[prop] = value;
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** AST の中のすべてのコードブロックをハイライトして、`highlight` に埋める（その場で書き換える）。 */
export async function attachHighlights(root: MdastNode): Promise<void> {
  const blocks: Array<Extract<MdastNode, { type: "code" }>> = [];
  const walk = (node: MdastNode) => {
    if (node.type === "code") blocks.push(node);
    if ("children" in node) node.children.forEach(walk);
  };
  walk(root);
  for (const block of blocks) {
    block.highlight ??= await highlightCode(block.value, block.lang);
  }
}

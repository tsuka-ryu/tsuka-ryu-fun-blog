import { parseBlocks, splitLines } from "#markdown/parse/block.js";
import { splitFrontmatter } from "#markdown/parse/frontmatter.js";
import { lintBody, validateFrontmatter } from "#markdown/parse/lint.js";
import { DiagnosticSink, LineIndex, type Diagnostic } from "#markdown/parse/source.js";

import type { MdastNode } from "#markdown/types.js";

// 自作の Markdown パーサーの入口。サーバー（公開時の検証）とブラウザ（エディタのプレビュー）の両方で、
// 同じコードを動かす。依存はなく、例外を投げない（書きかけの入力でも、必ず AST と診断を返す）。

export type { Diagnostic } from "#markdown/parse/source.js";
export { SAFE_URL_PATTERN } from "#markdown/parse/lint.js";

export interface ParsedMarkdown {
  ast: MdastNode;
  diagnostics: Diagnostic[];
}

export interface ParsedDocument extends ParsedMarkdown {
  /** frontmatter の中身。frontmatter がなければ null。 */
  frontmatter: Record<string, unknown> | null;
  /** frontmatter を除いた本文。 */
  body: string;
}

function sortDiagnostics(items: Diagnostic[]): Diagnostic[] {
  return items.sort((a, b) => a.from - b.from || a.ruleId.localeCompare(b.ruleId));
}

/** 本文だけ（frontmatter なし）を解析する。エディタの本文欄の解析に使う。 */
export function parseMarkdown(body: string): ParsedMarkdown {
  const sink = new DiagnosticSink(new LineIndex(body));
  const ast = parseBody(body, 0, sink);
  lintBody(body, ast, sink);
  return { ast, diagnostics: sortDiagnostics(sink.items) };
}

/** frontmatter つきの記事全体を解析する。診断の位置は、記事全体の先頭からのもの。 */
export function parseDocument(raw: string): ParsedDocument {
  const sink = new DiagnosticSink(new LineIndex(raw));
  const { data, body, bodyOffset } = splitFrontmatter(raw, sink);
  validateFrontmatter(data, sink);
  const ast = parseBody(body, bodyOffset, sink);
  lintBody(body, ast, sink, bodyOffset);
  return { ast, frontmatter: data, body, diagnostics: sortDiagnostics(sink.items) };
}

function parseBody(body: string, baseOffset: number, sink: DiagnosticSink): MdastNode {
  const lines = splitLines(body, baseOffset);
  const children = parseBlocks(lines, { lines: sink.lines, sink });
  return {
    type: "root",
    children,
    position: sink.lines.position(baseOffset, baseOffset + body.length),
  };
}

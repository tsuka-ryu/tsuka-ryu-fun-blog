import { parseDocument, type Diagnostic } from "#markdown/parse/index.js";
import { serializePostParts, type PostFields } from "#site/serialize.js";

import type { MdastNode } from "#markdown/types.js";

// エディタのプレビュー用の解析。公開時と同じパーサー・同じ検証を、入力のたびにブラウザで流す。
// 診断は、本文の中のもの（エディタの該当行に印を付ける）と、記事の設定（タイトル・日付など）のものに分ける。

export interface BodyDiagnostic {
  severity: "error" | "warning";
  ruleId: string;
  message: string;
  /** 本文の先頭からの位置。 */
  from: number;
  to: number;
  /** 本文の中の行・桁（1 始まり）。 */
  line: number;
  column: number;
}

export interface PreviewResult {
  ast: MdastNode;
  body: BodyDiagnostic[];
  /** 記事の設定（frontmatter に当たる項目）についての診断。位置は持たない。 */
  fields: Array<{ severity: "error" | "warning"; ruleId: string; message: string }>;
}

/** 本文の中の位置から、行・桁（1 始まり）を求める。 */
export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

function toBodyDiagnostic(d: Diagnostic, offset: number, body: string): BodyDiagnostic {
  const from = d.from - offset;
  const { line, column } = lineColumnAt(body, from);
  return {
    severity: d.severity,
    ruleId: d.ruleId,
    message: d.message,
    from,
    to: Math.max(from, d.to - offset),
    line,
    column,
  };
}

/** 編集中の記事を解析する。例外は投げない（書きかけでも、必ず AST と診断を返す）。 */
export function analyzePost(fields: PostFields): PreviewResult {
  const { frontmatter, body } = serializePostParts(fields);
  // 原文は `frontmatter + "\n\n" + body`。本文の先頭の位置を、診断の位置から引いて、本文の中の位置にする。
  const offset = frontmatter.length + 2;
  const { ast, diagnostics } = parseDocument(`${frontmatter}\n\n${body}`);

  const result: PreviewResult = { ast, body: [], fields: [] };
  for (const d of diagnostics) {
    if (d.from >= offset) result.body.push(toBodyDiagnostic(d, offset, body));
    else result.fields.push({ severity: d.severity, ruleId: d.ruleId, message: d.message });
  }
  return result;
}

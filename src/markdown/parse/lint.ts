import type { Diagnostic, DiagnosticSink } from "#markdown/parse/source.js";
import type { MdastNode } from "#markdown/types.js";

// 記事の検証。パーサーが返す AST とソースから、書き方の問題を診断として集める。
// 保存は常に通し、公開時に「error が 1 つでもあれば止める」ために使う。
// warning は表示だけで、公開は止めない。

/** link / image の URL に許可するスキーム・形。http(s) / mailto / tel はそのまま、
 *  絶対パス(/)・相対パス(./, ../)・フラグメント(#)・拡張子つきの素のパスを許す。
 *  javascript: や data: などは危険として弾く。 */
export const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:|\/|\.\.?\/|#|[\w./-]+$)/i;

/** frontmatter の date に要求する形式。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function walk(node: MdastNode, visit: (node: MdastNode) => void) {
  visit(node);
  if ("children" in node) {
    for (const child of node.children) walk(child, visit);
  }
}

function plainText(node: MdastNode): string {
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
}

/** frontmatter の必須項目と型を検証する。位置は frontmatter の先頭行にする。 */
export function validateFrontmatter(data: Record<string, unknown> | null, sink: DiagnosticSink) {
  if (data === null) {
    sink.add("error", "frontmatter", "frontmatter がありません", 0, 0);
    return;
  }
  const { title, date, draft, tags, description } = data;
  if (typeof title !== "string" || title.length === 0) {
    sink.add("error", "frontmatter", "frontmatter.title が必要です", 0, 0);
  }
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) {
    sink.add(
      "error",
      "frontmatter",
      `frontmatter.date は YYYY-MM-DD 形式で書いてください（実際: ${String(date)}）`,
      0,
      0,
    );
  }
  if (draft !== undefined && typeof draft !== "boolean") {
    sink.add(
      "error",
      "frontmatter",
      `frontmatter.draft は真偽値で書いてください（実際: ${JSON.stringify(draft)}）`,
      0,
      0,
    );
  }
  if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === "string"))) {
    sink.add("error", "frontmatter", "frontmatter.tags は文字列の配列で書いてください", 0, 0);
  }
  if (description !== undefined && typeof description !== "string") {
    sink.add("error", "frontmatter", "frontmatter.description は文字列で書いてください", 0, 0);
  }
}

/** 本文の AST とソースを検証する。 */
export function lintBody(source: string, root: MdastNode, sink: DiagnosticSink, baseOffset = 0) {
  const codeLines = new Set<number>();
  let previousDepth = 0;
  const seenHeadings = new Map<string, number>();

  walk(root, (node) => {
    if (node.type === "code" && node.position) {
      for (let line = node.position.start.line; line <= node.position.end.line; line++)
        codeLines.add(line);
    }

    if (node.type === "link" || node.type === "image") {
      if (!SAFE_URL_PATTERN.test(node.url)) {
        const from = node.position?.start.offset ?? 0;
        const to = node.position?.end.offset ?? from;
        sink.add("error", "unsafe-url", `安全でない URL です（${node.url}）`, from, to);
      }
    }

    if (node.type === "heading") {
      const from = node.position?.start.offset ?? 0;
      const to = node.position?.end.offset ?? from;
      // 最初の見出しは、どのレベルから始めてもよい。そのあとは、1 つずつしか深くできない。
      if (previousDepth !== 0 && node.depth > previousDepth + 1) {
        sink.add(
          "error",
          "heading-increment",
          `見出しのレベルが飛んでいます（h${previousDepth} の次に h${node.depth}）`,
          from,
          to,
        );
      }
      previousDepth = node.depth;
      const text = plainText(node).trim();
      if (seenHeadings.has(text)) {
        sink.add("error", "duplicate-heading", `同じ見出しが重複しています（${text}）`, from, to);
      }
      seenHeadings.set(text, node.depth);
    }

    if (node.type === "text" && node.position) {
      const base = node.position.start.offset;
      // 同じ英単語が続く（"the the"）。
      for (const m of node.value.matchAll(/\b([A-Za-z][A-Za-z']*)(\s+)\1\b/gi)) {
        sink.add(
          "error",
          "repeated-word",
          `同じ単語が続いています（${m[1]}）`,
          base + m.index,
          base + m.index + m[0].length,
        );
      }
      // 句読点の重複。誤字のことが多いが、引用などで正しいこともあるので警告にとどめる。
      for (const m of node.value.matchAll(/([。、，．！？!?])\1/g)) {
        sink.add(
          "warning",
          "repeated-punctuation",
          `句読点が重複しています（${m[0]}）`,
          base + m.index,
          base + m.index + m[0].length,
        );
      }
    }
  });

  // 行ごとの検査。コードブロックの中は対象外。
  const lines = source.split("\n");
  let offset = baseOffset;
  let blankRun = 0;
  for (const [n, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r$/, "");
    const lineNo = n + 1;
    const from = offset;
    offset += rawLine.length + 1;
    // baseOffset が 0 でない（frontmatter のある）ときは、行番号がずれるので、offset から行を引いて判定する。
    const inCode = codeLines.has(lineNo + baseLineShift(sink, baseOffset));
    if (inCode) {
      blankRun = 0;
      continue;
    }
    if (/[ \t]+$/.test(line) && line.trim() !== "") {
      sink.add(
        "error",
        "trailing-spaces",
        "行末に空白があります",
        from + line.trimEnd().length,
        from + line.length,
      );
    }
    if (line.trim() === "") {
      blankRun++;
      if (blankRun === 2) {
        sink.add(
          "warning",
          "max-consecutive-blank-lines",
          "空行が 2 行以上続いています",
          from,
          from + line.length,
        );
      }
    } else {
      blankRun = 0;
    }
  }
}

/** 本文の先頭が、ソース全体の何行目にあたるかの分（0 始まり）。 */
function baseLineShift(sink: DiagnosticSink, baseOffset: number): number {
  return sink.lines.point(baseOffset).line - 1;
}

export type { Diagnostic };

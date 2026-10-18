import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseDocument } from "#markdown/parse/index.js";
import { parse, prepareSource } from "@ox-content/napi";
import { describe, expect, test } from "vitest";

// 既存の記事を、現行の ox-content と自作パーサーの両方で解析して、AST を比べる。
// 自作パーサーが、レンダラーに渡る形を変えていないことの確認。ox-content を外すとき（移行の最後）に、
// このテストごと消す。
//
// ox-content には、次の不具合がある。自作パーサーは CommonMark の規則どおりに解析するので、
// この不具合を含む記事（下の hasKnownOxContentBug）で、厳密な比較が食い違ったときだけ、
// 構造と本文だけを比べる緩い比較にする。
//   1. 単語の途中の `_` を強調として扱う（`oxc_parser` が `oxc<em>parser` になり、`_` が消える）。
//   2. インラインコードの中にバッククォートがあると（`` `` }c` `` や `` ` ``` ` ``）、正しく解析できない。

const postsDir = path.resolve(import.meta.dirname, "../../../content/posts");
const files = readdirSync(postsDir).filter((f) => f.endsWith(".md"));

type Loose = { type: string; [key: string]: unknown };

/** レンダラーが使うフィールドだけを残し、表記ゆれ（null と undefined、隣り合う text）をならす。 */
function normalize(node: Loose): Loose {
  const children = (Array.isArray(node.children) ? (node.children as Loose[]) : []).map(normalize);
  const merged: Loose[] = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (child.type === "text" && last?.type === "text") {
      last.value = String(last.value) + String(child.value);
    } else {
      merged.push(child);
    }
  }
  switch (node.type) {
    case "heading":
      return { type: "heading", depth: node.depth, children: merged };
    case "text":
    case "inlineCode":
      return { type: node.type, value: node.value };
    case "link":
      return {
        type: "link",
        url: node.url,
        ...(node.title ? { title: node.title } : {}),
        children: merged,
      };
    case "image":
      return { type: "image", url: node.url, alt: node.alt ?? "" };
    case "list":
      return {
        type: "list",
        ordered: Boolean(node.ordered),
        ...(node.ordered ? { start: node.start } : {}),
        children: merged,
      };
    case "code":
      return {
        type: "code",
        value: node.value,
        ...(node.lang ? { lang: node.lang } : {}),
        ...(node.meta ? { meta: node.meta } : {}),
      };
    case "table":
      return { type: "table", align: node.align ?? [], children: merged };
    case "thematicBreak":
    case "break":
      return { type: node.type };
    default:
      return { type: node.type, children: merged };
  }
}

/** この記事が、ox-content の既知の不具合の書き方を含むか。自作パーサーの AST から判定する。 */
function hasKnownOxContentBug(node: Loose): boolean {
  if (node.type === "text" && /[A-Za-z0-9]_[A-Za-z0-9]/.test(String(node.value))) return true;
  if (node.type === "inlineCode" && String(node.value).includes("`")) return true;
  return (Array.isArray(node.children) ? (node.children as Loose[]) : []).some(
    hasKnownOxContentBug,
  );
}

/** 緩い比較用。インラインの装飾を捨てて、ブロックの構造と本文だけを残す。 */
function relax(node: Loose): Loose {
  const children = Array.isArray(node.children) ? (node.children as Loose[]) : [];
  const inline = new Set([
    "text",
    "inlineCode",
    "emphasis",
    "strong",
    "delete",
    "link",
    "image",
    "break",
  ]);
  const plain = (n: Loose): string =>
    "value" in n
      ? String(n.value)
      : Array.isArray(n.children)
        ? (n.children as Loose[]).map(plain).join("")
        : "";
  const squash = (text: string) => text.replace(/[_` \n]/g, "");
  if (children.length > 0 && children.every((c) => inline.has(c.type))) {
    return {
      type: node.type,
      ...(node.depth ? { depth: node.depth } : {}),
      text: squash(children.map(plain).join("")),
    };
  }
  if (node.type === "code")
    return { type: "code", value: node.value, ...(node.lang ? { lang: node.lang } : {}) };
  if (node.type === "table") return { type: "table", children: children.map(relax) };
  return {
    type: node.type,
    ...(node.depth ? { depth: node.depth } : {}),
    ...(node.type === "list" ? { ordered: Boolean(node.ordered) } : {}),
    children: children.map(relax),
  };
}

/** 最初に食い違う場所を、パスつきで返す。同じなら null。 */
function firstDiff(a: unknown, b: unknown, at = "root"): string | null {
  if (typeof a !== typeof b)
    return `${at}: 型が違う（${JSON.stringify(a)?.slice(0, 200)} / ${JSON.stringify(b)?.slice(0, 200)}）`;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDiff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const d = firstDiff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${at}.${key}`,
      );
      if (d) return d;
    }
    return null;
  }
  return a === b
    ? null
    : `${at}: ${JSON.stringify(a)?.slice(0, 400)} ≠ ${JSON.stringify(b)?.slice(0, 400)}`;
}

describe("既存の記事の AST が ox-content と一致する", () => {
  test.each(files)("%s", (file) => {
    const raw = readFileSync(path.join(postsDir, file), "utf8");
    const prepared = prepareSource(raw, { frontmatter: true });
    const expected = JSON.parse(
      parse(prepared.content, {
        gfm: true,
        tables: true,
        taskLists: true,
        strikethrough: true,
        autolinks: true,
      }).ast,
    ) as Loose;

    const mine = parseDocument(raw);
    expect(mine.body).toBe(prepared.content);
    expect(mine.frontmatter).toEqual(prepared.frontmatter);
    const mineAst = mine.ast as unknown as Loose;
    // まず厳密に比べ、食い違ったときだけ、既知の不具合を含む記事に限って緩く比べる。
    let diff = firstDiff(normalize(mineAst), normalize(expected));
    if (diff && hasKnownOxContentBug(mineAst)) {
      diff = firstDiff(relax(normalize(mineAst)), relax(normalize(expected)));
    }
    // 食い違いの場所と中身を、省略せずに出す。
    if (diff) throw new Error(diff);
  });
});

describe("既存の記事に、error の診断がない", () => {
  test.each(files)("%s", (file) => {
    const raw = readFileSync(path.join(postsDir, file), "utf8");
    const errors = parseDocument(raw).diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((d) => `${d.line}:${d.column} ${d.ruleId} ${d.message}`)).toEqual([]);
  });
});

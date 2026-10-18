import { attachHighlights, highlightCode } from "#markdown/highlight.js";
import { parseMarkdown } from "#markdown/parse/index.js";
import { describe, expect, test } from "vitest";

describe("highlightCode", () => {
  test("対応する言語は、トークンごとに、ライト・ダークの色の CSS 変数がつく", async () => {
    const result = await highlightCode("const a: number = 1;", "ts");
    expect(result.lines).toHaveLength(1);
    const styled = result.lines[0]?.find((t) => t.content === "const");
    expect(Object.keys(styled?.htmlStyle ?? {})).toEqual(
      expect.arrayContaining(["--shiki-light", "--shiki-dark"]),
    );
    expect(Object.keys(result.rootStyle ?? {})).toEqual(
      expect.arrayContaining(["--shiki-light-bg", "--shiki-dark-bg"]),
    );
  });

  test("別名（ts / js / sh / yml）は正式名に直す", async () => {
    for (const lang of ["ts", "js", "sh", "yml", "md", "TS"]) {
      const result = await highlightCode("x", lang);
      expect(result.lines.length, lang).toBeGreaterThan(0);
    }
  });

  test("未対応・未指定の言語は、色なしで、元のコードがそのまま残る", async () => {
    const code = "line1\n  line2";
    for (const lang of [undefined, null, "text", "no-such-lang"]) {
      const result = await highlightCode(code, lang);
      expect(result.lines.map((line) => line.map((t) => t.content).join(""))).toEqual([
        "line1",
        "  line2",
      ]);
    }
  });

  test("トークンをつなげると、元のコードに戻る", async () => {
    const code = 'fn main() {\n    println!("hi");\n}\n';
    const result = await highlightCode(code, "rust");
    expect(result.lines.map((line) => line.map((t) => t.content).join("")).join("\n")).toBe(code);
  });
});

describe("attachHighlights", () => {
  test("AST のすべてのコードブロックに highlight を埋める。入れ子の中も対象", async () => {
    const { ast } = parseMarkdown(
      "```ts\nlet a = 1;\n```\n\n- 項目\n\n  ```rust\nfn x() {}\n  ```\n",
    );
    await attachHighlights(ast);
    const codes: unknown[] = [];
    const walk = (n: { type: string; children?: unknown[]; highlight?: unknown }) => {
      if (n.type === "code") codes.push(n.highlight);
      for (const c of n.children ?? []) walk(c as never);
    };
    walk(ast as never);
    expect(codes.length).toBe(2);
    expect(codes.every((h) => h !== undefined)).toBe(true);
  });
});

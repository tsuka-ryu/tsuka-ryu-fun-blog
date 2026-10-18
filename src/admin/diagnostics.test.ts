import { analyzePost, lineColumnAt } from "#admin/diagnostics.js";
import { diffLines } from "#admin/diff.js";
import { fitWidth, imageMarkdown } from "#admin/image.js";
import { describe, expect, it } from "vitest";

const fields = (extra: Partial<Parameters<typeof analyzePost>[0]> = {}) => ({
  title: "題名",
  description: "",
  date: "2026-10-18",
  tags: [],
  body: "## 見出し\n\n本文\n",
  ...extra,
});

describe("analyzePost", () => {
  it("問題のない記事は、診断が空", () => {
    const result = analyzePost(fields());
    expect(result.body).toEqual([]);
    expect(result.fields).toEqual([]);
    expect(result.ast.type).toBe("root");
  });

  it("本文の診断は、本文の先頭からの位置と、行・桁で返る", () => {
    // 3 行目の「## 見出し」が 1 行目と重複する。
    const result = analyzePost(fields({ body: "## 見出し\n\n本文\n\n## 見出し\n" }));
    const duplicate = result.body.find((d) => d.ruleId === "duplicate-heading");
    expect(duplicate).toBeDefined();
    expect(duplicate!.line).toBe(5);
    expect(duplicate!.column).toBe(1);
    expect("## 見出し\n\n本文\n\n## 見出し\n".slice(duplicate!.from).startsWith("## 見出し")).toBe(
      true,
    );
  });

  it("記事の設定の問題は、位置なしの診断として分けて返る", () => {
    const result = analyzePost(fields({ date: "2026/10/18" }));
    expect(result.fields.some((d) => d.severity === "error" && d.message.includes("date"))).toBe(
      true,
    );
    expect(result.body).toEqual([]);
  });

  it("書きかけの入力でも例外を投げない", () => {
    for (const body of ["", "```ts\n未完のコード", "[リンク](", "> > > ", "- \n  - \n"]) {
      expect(() => analyzePost(fields({ body }))).not.toThrow();
    }
  });
});

describe("lineColumnAt", () => {
  it("1 始まりの行・桁を返す", () => {
    expect(lineColumnAt("ab\ncd", 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumnAt("ab", 99)).toEqual({ line: 1, column: 3 });
  });
});

describe("diffLines", () => {
  it("追加・削除・同じ行を区別する", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("同じ内容なら、すべて same", () => {
    expect(diffLines("x\ny", "x\ny").every((l) => l.kind === "same")).toBe(true);
  });

  it("空との比較ができる", () => {
    expect(diffLines("", "a").map((l) => l.kind)).toEqual(["remove", "add"]);
  });
});

describe("image helpers", () => {
  it("幅だけ縮小し、拡大しない", () => {
    expect(fitWidth(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWidth(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("Markdown の画像記法を作る（altの角括弧は落とす）", () => {
    expect(imageMarkdown("/uploads/a.webp", "図[1]")).toBe("![図1](/uploads/a.webp)");
  });
});

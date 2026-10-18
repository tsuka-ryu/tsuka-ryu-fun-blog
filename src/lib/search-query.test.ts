import { searchDocuments, type SearchDocument } from "#lib/search-query.js";
import { describe, expect, test } from "vitest";

const docs: SearchDocument[] = [
  {
    id: "a",
    title: "Rust のパーサーを読む",
    url: "/posts/a",
    headings: ["字句解析", "構文解析"],
    body: "パーサーは文字列を木にします。字句解析で、トークンに分けます。",
    code: "fn parse() {}",
  },
  {
    id: "b",
    title: "ブログの作り直し",
    url: "/posts/b",
    headings: ["構成"],
    body: "Void と Cloudflare でブログを作り直します。パーサーも自作します。",
    code: "",
  },
  {
    id: "c",
    title: "シェーダーの入門",
    url: "/posts/c",
    headings: [],
    body: "WGSL を書きます。",
    code: "@fragment fn main() {}",
  },
];

const ids = (q: string, limit?: number) => searchDocuments(docs, q, limit).map((r) => r.id);

describe("searchDocuments", () => {
  test("部分一致で探す（日本語）", () => {
    expect(ids("パーサー")).toEqual(["a", "b"]);
    expect(ids("字句")).toEqual(["a"]);
  });

  test("タイトルに含まれる記事を、本文だけの記事より上にする", () => {
    expect(ids("パーサー")[0]).toBe("a");
    expect(ids("ブログ")[0]).toBe("b");
  });

  test("複数の語は、すべて含む記事だけ（空白は全角も可）", () => {
    expect(ids("パーサー 字句")).toEqual(["a"]);
    expect(ids("パーサー　Void")).toEqual(["b"]);
    expect(ids("パーサー wgsl")).toEqual([]);
  });

  test("大文字・小文字と、全角・半角をならす", () => {
    expect(ids("RUST")).toEqual(["a"]);
    expect(ids("ｖｏｉｄ")).toEqual(["b"]);
  });

  test("コードの中も探す", () => {
    expect(ids("@fragment")).toEqual(["c"]);
  });

  test("スニペットは、本文の最初の一致の前後。本文になければ見出し", () => {
    expect(searchDocuments(docs, "トークン")[0]?.snippet).toContain("トークンに分けます");
    expect(searchDocuments(docs, "構文解析")[0]?.snippet).toBe("構文解析");
  });

  test("空の検索語は、何も返さない。件数の上限がある", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("の", 1).length).toBeLessThanOrEqual(1);
  });
});

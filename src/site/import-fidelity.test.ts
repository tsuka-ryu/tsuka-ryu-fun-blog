import { readFileSync, readdirSync } from "node:fs";

import { parseDocument } from "#markdown/parse/index.js";
import { serializePost } from "#site/serialize.js";
import { describe, expect, it } from "vitest";

// 既存の記事（content/posts/*.md）を取り込んで `.md` として配信し直しても、タイトル・説明・日付・タグ・本文が
// 変わらないこと（frontmatter の書式は、D1 の項目から作り直すので変わる）。移行で記事が欠落・変質しないことの確認。

const dir = new URL("../../content/posts/", import.meta.url);
const files = readdirSync(dir).filter((file) => file.endsWith(".md"));

/** 取り込みと同じ変換: 原文 → 項目 → frontmatter 付きの原文。 */
function roundTrip(raw: string) {
  const parsed = parseDocument(raw);
  const data = parsed.frontmatter as {
    title: string;
    description?: string;
    date: string;
    tags?: string[];
    draft?: boolean;
  };
  const fields = {
    title: data.title,
    description: data.description ?? "",
    date: data.date,
    tags: data.tags ?? [],
    // 取り込み（import-markdown.ts）と同じく、frontmatter の直後の空行は落とす。
    body: parsed.body.replace(/^(?:\r?\n)+/, ""),
  };
  return { parsed, data, fields, again: parseDocument(serializePost(fields)) };
}

describe("既存の記事の取り込みで、内容が変わらない", () => {
  it("記事が見つかっている", () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
  });

  for (const file of files) {
    it(file, () => {
      const raw = readFileSync(new URL(file, dir), "utf8");
      const { parsed, data, fields, again } = roundTrip(raw);

      // 元の記事に、検証で error になる診断がない（取り込めない記事がない）。
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      // 作り直した原文も、error なく読み直せる。
      expect(again.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

      // frontmatter の項目が一致する（draft は、公開の状態として別に持つ）。
      expect(again.frontmatter).toEqual({
        title: data.title,
        ...(data.description ? { description: data.description } : {}),
        date: data.date,
        ...(fields.tags.length > 0 ? { tags: fields.tags } : {}),
      });

      // 本文が一致する（末尾の改行の有無だけは、保存時にそろえる）。
      expect(again.body.replace(/^\n+/, "").trimEnd()).toBe(fields.body.trimEnd());
      // 本文の構造も同じ（ノードの種類の並び）。
      const shape = (node: unknown): unknown => {
        const n = node as { type: string; children?: unknown[] };
        return [n.type, ...(n.children ?? []).map(shape)];
      };
      expect(shape(again.ast)).toEqual(shape(parsed.ast));
    });
  }
});

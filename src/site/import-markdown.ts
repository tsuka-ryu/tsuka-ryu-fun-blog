import { parseDocument } from "#markdown/parse/index.js";
import { saveDraft, type Db } from "#site/posts.js";
import { publishPost, type PublishDeps, type PublishResult } from "#site/publish.js";

import type { Diagnostic } from "#markdown/parse/index.js";

// frontmatter 付きの Markdown 原文（`content/posts/*.md`）を、下書きとして保存し、`draft: true` でなければ公開する。
// slug をキーにした上書きなので、何度流しても重複せず、変更だけが反映される（冪等）。

export type ImportResult =
  | { slug: string; status: "published"; warnings: Diagnostic[] }
  | { slug: string; status: "draft" }
  | { slug: string; status: "invalid"; errors: Diagnostic[] }
  | { slug: string; status: "failed"; reason: string };

export async function importMarkdown(
  deps: PublishDeps,
  slug: string,
  raw: string,
): Promise<ImportResult> {
  const parsed = parseDocument(raw);
  // 公開と同じ検証を、保存の前にも通す（壊れた記事は、下書きにも入れない）。
  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) return { slug, status: "invalid", errors };

  const data = parsed.frontmatter as {
    title: string;
    description?: string;
    date: string;
    tags?: string[];
    draft?: boolean;
  };
  await saveDraft(
    deps.db as Db,
    {
      slug,
      title: data.title,
      description: data.description ?? "",
      date: data.date,
      tags: data.tags ?? [],
      // frontmatter の直後の空行は、保存するときに足すので、ここでは落とす。
      body: parsed.body.replace(/^(?:\r?\n)+/, ""),
    },
    deps.now(),
  );
  if (data.draft) return { slug, status: "draft" };

  const result: PublishResult = await publishPost(deps, slug);
  if (result.ok) return { slug, status: "published", warnings: result.warnings };
  if (result.reason === "invalid") return { slug, status: "invalid", errors: result.errors };
  return { slug, status: "failed", reason: result.reason };
}

import { TagList } from "#components/TagList.js";
import { formatDate } from "#lib/time.js";
import { extractToc } from "#lib/toc.js";
import { highlightCode } from "#markdown/highlight.js";
import { Markdown } from "#markdown/index.js";
import { useEffect, useMemo, useState } from "react";

import type { PreviewResult } from "#admin/diagnostics.js";
import type { HighlightedCode, MdastNode } from "#markdown/types.js";

type CodeNode = Extract<MdastNode, { type: "code" }>;

// 同じコードを入力のたびに再度ハイライトしないための、言語 + コードをキーにした結果の置き場。
const highlightCache = new Map<string, HighlightedCode>();

function collectCode(node: MdastNode, into: CodeNode[]): void {
  if (node.type === "code") into.push(node);
  if ("children" in node) node.children.forEach((child) => collectCode(child, into));
}

/**
 * プレビューの AST にコードのハイライトを埋める。キャッシュにあるものは同期的に、ないものは非同期に埋めて、
 * 終わったら再描画を促す（その間は色なしで表示される）。
 */
function useHighlights(ast: MdastNode): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const blocks: CodeNode[] = [];
    collectCode(ast, blocks);
    let cancelled = false;
    void (async () => {
      let changed = false;
      for (const block of blocks) {
        const key = `${block.lang ?? ""}\u0000${block.value}`;
        const cached = highlightCache.get(key);
        if (cached) {
          block.highlight = cached;
          continue;
        }
        const result = await highlightCode(block.value, block.lang);
        highlightCache.set(key, result);
        if (cancelled) return;
        block.highlight = result;
        changed = true;
      }
      if (changed && !cancelled) setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [ast]);
  return version;
}

interface Props {
  title: string;
  date: string;
  tags: string[];
  result: PreviewResult;
  /** エラー・警告の位置（本文の先頭からの位置）をクリックされたとき。 */
  onJump: (offset: number) => void;
  /** 公開の検証に失敗したときに、サーバーが返した診断（行・桁つき）。 */
  serverErrors?: Array<{ ruleId: string; message: string; line: number; column: number }>;
}

export function Preview({ title, date, tags, result, onJump, serverErrors }: Props) {
  // 見出しにアンカーの id を付ける（公開側と同じ描画にするため）。
  useMemo(() => extractToc(result.ast), [result.ast]);
  const version = useHighlights(result.ast);

  const errors =
    result.body.filter((d) => d.severity === "error").length +
    result.fields.filter((d) => d.severity === "error").length;
  const warnings =
    result.body.filter((d) => d.severity === "warning").length +
    result.fields.filter((d) => d.severity === "warning").length;

  return (
    <div className="admin-preview">
      <section className="admin-diagnostics" aria-label="エラーと警告">
        <h2 className="admin-diagnostics-title">
          {errors === 0 && warnings === 0
            ? "エラー・警告はありません"
            : `エラー ${errors} 件 / 警告 ${warnings} 件`}
        </h2>
        {(result.fields.length > 0 ||
          result.body.length > 0 ||
          (serverErrors?.length ?? 0) > 0) && (
          <ul className="admin-diagnostics-list">
            {result.fields.map((d, i) => (
              <li key={`f${i}`} className={`admin-diagnostic admin-diagnostic-${d.severity}`}>
                <span className="admin-diagnostic-badge">
                  {d.severity === "error" ? "エラー" : "警告"}
                </span>
                <span>記事の設定: {d.message}</span>
              </li>
            ))}
            {result.body.map((d, i) => (
              <li key={`b${i}`} className={`admin-diagnostic admin-diagnostic-${d.severity}`}>
                <button
                  type="button"
                  className="admin-diagnostic-jump"
                  onClick={() => onJump(d.from)}
                >
                  <span className="admin-diagnostic-badge">
                    {d.severity === "error" ? "エラー" : "警告"}
                  </span>
                  <span className="admin-diagnostic-pos">
                    {d.line}:{d.column}
                  </span>
                  <span>{d.message}</span>
                  <span className="admin-diagnostic-rule">{d.ruleId}</span>
                </button>
              </li>
            ))}
            {serverErrors?.map((d, i) => (
              <li key={`s${i}`} className="admin-diagnostic admin-diagnostic-error">
                <span className="admin-diagnostic-badge">公開エラー</span>
                <span>
                  {d.line}:{d.column} {d.message} ({d.ruleId})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* version は、非同期のハイライトが埋まったあとの再描画のきっかけ（key で描き直す）。 */}
      <article className="post-page" key={version}>
        <header className="post-header">
          <h1 className="post-title">{title || "（タイトル未入力）"}</h1>
          <p className="post-meta">
            <time dateTime={date}>
              {/^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDate(date) : date}
            </time>
          </p>
          <TagList tags={tags} />
        </header>
        <div className="post-body">
          <Markdown root={result.ast} />
        </div>
      </article>
    </div>
  );
}

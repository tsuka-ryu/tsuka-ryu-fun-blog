import {
  getRevision,
  listRevisions,
  restoreRevision,
  type RevisionSummary,
  type SaveFields,
} from "#admin/api.js";
import { diffLines } from "#admin/diff.js";
import { useEffect, useMemo, useState } from "react";

interface Props {
  slug: string;
  /** いまの下書き（差分の比較先）。 */
  current: SaveFields;
  onClose: () => void;
  /** 巻き戻したあと。呼び出し元が、サーバーの下書きを読み直す。 */
  onRestored: () => void;
}

const KIND_LABEL: Record<RevisionSummary["kind"], string> = {
  draft: "いまの下書き",
  snapshot: "自動の履歴",
  published: "公開した版",
};

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));

/** 履歴の一覧と、選んだ版といまの下書きとの差分、巻き戻し。 */
export function HistoryPanel({ slug, current, onClose, onRestored }: Props) {
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [selected, setSelected] = useState<(SaveFields & { id: number }) | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void listRevisions(slug).then((result) => {
      if (result.ok) setRevisions(result.data.revisions);
      else setMessage("履歴を読み込めませんでした");
    });
  }, [slug]);

  const diff = useMemo(
    () => (selected ? diffLines(selected.body, current.body) : []),
    [selected, current.body],
  );

  const select = async (id: number) => {
    const result = await getRevision(slug, id);
    if (result.ok) setSelected(result.data);
    else setMessage("この版を読み込めませんでした");
  };

  const restore = async () => {
    if (!selected) return;
    if (!window.confirm("この版を下書きに戻します。いまの下書きは履歴に残ります。よろしいですか？"))
      return;
    const result = await restoreRevision(slug, selected.id);
    if (result.ok) onRestored();
    else setMessage("巻き戻せませんでした");
  };

  return (
    <aside className="admin-history" aria-label="履歴">
      <header className="admin-history-header">
        <h2>履歴</h2>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </header>
      {message && <p role="alert">{message}</p>}
      {revisions === null ? (
        <p>読み込み中…</p>
      ) : (
        <ul className="admin-history-list">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button
                type="button"
                className={selected?.id === revision.id ? "is-selected" : undefined}
                onClick={() => void select(revision.id)}
              >
                <span className={`admin-history-kind admin-history-kind-${revision.kind}`}>
                  {KIND_LABEL[revision.kind]}
                </span>
                <time dateTime={revision.createdAt}>{formatTime(revision.createdAt)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section className="admin-history-diff">
          <div className="admin-history-diff-head">
            <h3>この版 → いまの下書き（本文）</h3>
            <button type="button" onClick={() => void restore()}>
              この版に戻す
            </button>
          </div>
          <pre className="admin-diff">
            {diff.map((line, i) => (
              <div key={i} className={`admin-diff-line admin-diff-${line.kind}`}>
                <span aria-hidden="true">
                  {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                </span>
                {line.text || " "}
              </div>
            ))}
          </pre>
        </section>
      )}
    </aside>
  );
}

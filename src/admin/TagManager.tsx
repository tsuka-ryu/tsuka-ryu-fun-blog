import { listTags, renameTag, type TagCount } from "#admin/api.js";
import { useState } from "react";

// アイランドとして使うので、default export にする（named export は、アイランドとして読み込まれない）。
export default function TagManager({ initialTags }: { initialTags: TagCount[] }) {
  const [tags, setTags] = useState(initialTags);
  const [editing, setEditing] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (from: string) => {
    const target = to.trim();
    if (!target || target === from) return;
    setMessage("変更中…");
    const result = await renameTag(from, target);
    if (!result.ok) {
      setMessage(`変更できませんでした: ${result.error.error}`);
      return;
    }
    const failed = result.data.failed.length;
    setMessage(
      `${result.data.renamed.length} 件の記事のタグを変更しました${failed > 0 ? `（${failed} 件は公開し直せませんでした）` : ""}`,
    );
    const refreshed = await listTags();
    if (refreshed.ok) setTags(refreshed.data.tags);
    setEditing(null);
  };

  return (
    <>
      {message && <p role="status">{message}</p>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>タグ</th>
            <th>URL</th>
            <th>記事数</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tags.map((tag) => (
            <tr key={tag.slug}>
              <td>
                {editing === tag.name ? (
                  <input
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    aria-label={`${tag.name} の新しい名前`}
                  />
                ) : (
                  tag.name
                )}
              </td>
              <td>
                <code>/tags/{tag.slug}</code>
              </td>
              <td>{tag.count}</td>
              <td>
                {editing === tag.name ? (
                  <>
                    <button type="button" onClick={() => void submit(tag.name)}>
                      変更する
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>
                      やめる
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(tag.name);
                      setTo(tag.name);
                    }}
                  >
                    名前を変える
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

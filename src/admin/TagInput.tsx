import { listTags, type TagCount } from "#admin/api.js";
import { tagSlug } from "#lib/tag-slug.js";
import { useEffect, useState, type KeyboardEvent } from "react";

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/**
 * タグの入力。既存のタグを候補に出し、新しく入れるタグが既存のタグと「URL 上は同じ（スラッグが同じ）なのに
 * 表記が違う」ときは、表記ゆれとして警告する（Git と git など）。
 */
export function TagInput({ tags, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [known, setKnown] = useState<TagCount[]>([]);

  useEffect(() => {
    void listTags().then((result) => {
      if (result.ok) setKnown(result.data.tags);
    });
  }, []);

  const add = (raw: string) => {
    const name = raw.trim();
    if (!name || tags.includes(name)) return;
    onChange([...tags, name]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME の変換確定の Enter では追加しない。
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const variants = (name: string) => {
    const slug = tagSlug(name);
    return known.find((tag) => tag.slug === slug && tag.name !== name);
  };
  const suggestions = known
    .filter(
      (tag) =>
        !tags.includes(tag.name) &&
        (!draft || tag.name.toLowerCase().includes(draft.toLowerCase())),
    )
    .slice(0, 8);
  const draftVariant = draft.trim() ? variants(draft.trim()) : undefined;

  return (
    <div className="admin-tags">
      <ul className="admin-tag-chips">
        {tags.map((tag) => {
          const variant = variants(tag);
          return (
            <li key={tag} className={`admin-tag-chip${variant ? " admin-tag-chip-warn" : ""}`}>
              {tag}
              {variant && (
                <span
                  className="admin-tag-warn"
                  title={`既存のタグ「${variant.name}」と URL が同じです`}
                >
                  {" "}
                  ⚠ {variant.name}?
                </span>
              )}
              <button
                type="button"
                aria-label={`${tag} を外す`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
              >
                ×
              </button>
            </li>
          );
        })}
        <li className="admin-tag-field">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => add(draft)}
            placeholder="タグを追加（Enter）"
            aria-label="タグを追加"
            list="admin-tag-suggestions"
          />
        </li>
      </ul>
      <datalist id="admin-tag-suggestions">
        {suggestions.map((tag) => (
          <option key={tag.slug} value={tag.name}>
            {tag.count} 件
          </option>
        ))}
      </datalist>
      {draftVariant && (
        <p className="admin-tag-hint">
          「{draftVariant.name}」（{draftVariant.count} 件）と URL が同じです。表記を揃えるなら「
          {draftVariant.name}」を使ってください。
        </p>
      )}
    </div>
  );
}

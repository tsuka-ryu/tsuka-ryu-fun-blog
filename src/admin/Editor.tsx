import { deletePost, getPost, publish, savePost, unpublish, type PostDetail } from "#admin/api.js";
import { CodeEditor, type CodeEditorHandle } from "#admin/CodeEditor.js";
import { analyzePost } from "#admin/diagnostics.js";
import { HistoryPanel } from "#admin/HistoryPanel.js";
import { imageMarkdown, uploadImage } from "#admin/image.js";
import { Preview } from "#admin/Preview.js";
import { TagInput } from "#admin/TagInput.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 記事の編集画面。タイトル・日付・タグなどの設定と、本文の Markdown エディタ、プレビュー、履歴を持つ。
// 入力が止まって数秒たつと、自動で下書きを保存する。公開は、検証（プレビューと同じ）に通る記事だけ。

const AUTOSAVE_DELAY_MS = 2000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Props {
  /** 既存の記事を開くときの内容。新規作成なら null。 */
  post: PostDetail | null;
  /** 新規作成の日付の初期値（`YYYY-MM-DD`）。 */
  today: string;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "保存済み",
  dirty: "未保存の変更あり",
  saving: "保存中…",
  error: "保存に失敗しました",
};

export default function Editor({ post, today }: Props) {
  const isNew = post === null;
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [title, setTitle] = useState(post?.title ?? "");
  const [date, setDate] = useState(post?.date ?? today);
  const [description, setDescription] = useState(post?.description ?? "");
  const [tags, setTags] = useState<string[]>(post?.tags ?? []);
  const [body, setBody] = useState(post?.body ?? "");

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [created, setCreated] = useState(!isNew);
  const [status, setStatus] = useState(post?.status ?? "draft");
  const [unpublished, setUnpublished] = useState(post?.hasUnpublishedChanges ?? true);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<
    Array<{ ruleId: string; message: string; line: number; column: number }> | undefined
  >();

  const editor = useRef<CodeEditorHandle>(null);
  const latest = useRef({ slug, title, date, description, tags, body });
  latest.current = { slug, title, date, description, tags, body };
  const dirtyVersion = useRef(0);
  const firstRender = useRef(true);

  // 入力のたびに、公開時と同じ検証を流す（プレビューのエラー表示と、エディタの印に使う）。
  const result = useMemo(
    () => analyzePost({ title, description, date, tags, body }),
    [title, description, date, tags, body],
  );
  const errorCount =
    result.body.filter((d) => d.severity === "error").length +
    result.fields.filter((d) => d.severity === "error").length;
  const slugValid = SLUG_PATTERN.test(slug) && slug.length <= 100;

  const save = useCallback(async (): Promise<boolean> => {
    const current = latest.current;
    if (!SLUG_PATTERN.test(current.slug)) return false;
    const version = dirtyVersion.current;
    setSaveState("saving");
    const response = await savePost(current.slug, {
      title: current.title,
      description: current.description,
      date: current.date,
      tags: current.tags,
      body: current.body,
    });
    if (!response.ok) {
      setSaveState("error");
      setNotice({ kind: "error", text: `保存できませんでした: ${response.error.error}` });
      return false;
    }
    // 保存している間に、さらに編集されていたら、まだ未保存のまま。
    setSaveState(version === dirtyVersion.current ? "saved" : "dirty");
    if (!created) {
      setCreated(true);
      // 新規作成した記事の URL に切り替える（再読み込みしても同じ記事が開く）。
      window.history.replaceState(null, "", `/admin/posts/${current.slug}`);
    }
    setUnpublished(true);
    return true;
  }, [created]);

  // 自動保存。入力が止まってから数秒後に保存する。
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    dirtyVersion.current += 1;
    setSaveState("dirty");
    if (!slugValid) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [slug, title, date, description, tags, body, slugValid, save]);

  // 未保存のままページを離れようとしたら、確認する。
  useEffect(() => {
    if (saveState === "saved") return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  const onImages = useCallback(
    async (files: File[]) => {
      if (!SLUG_PATTERN.test(latest.current.slug)) {
        setNotice({ kind: "error", text: "画像を入れる前に、slug を入力してください" });
        return;
      }
      // 画像は記事に紐付けて保存するので、記事を先に作っておく。
      if (!(await save())) return;
      for (const file of files) {
        setNotice({ kind: "ok", text: "画像をアップロード中…" });
        const uploaded = await uploadImage(file, latest.current.slug);
        if (!uploaded.ok) {
          setNotice({ kind: "error", text: uploaded.message });
          return;
        }
        editor.current?.insert(`${imageMarkdown(uploaded.url)}\n`);
      }
      setNotice({ kind: "ok", text: "画像を挿入しました" });
    },
    [save],
  );

  const onPublish = async () => {
    setServerErrors(undefined);
    if (!(await save())) return;
    const response = await publish(latest.current.slug);
    if (response.ok) {
      setStatus("published");
      setUnpublished(false);
      setNotice({
        kind: response.data.revalidateError ? "error" : "ok",
        text: response.data.revalidateError
          ? `公開しました。ただしキャッシュの更新に失敗しました（もう一度公開すると直ります）: ${response.data.revalidateError}`
          : "公開しました",
      });
      return;
    }
    if (response.error.error === "invalid") {
      setServerErrors(response.error.errors);
      setTab("preview");
      setNotice({ kind: "error", text: "検証に通らないため、公開できませんでした" });
    } else {
      setNotice({ kind: "error", text: `公開できませんでした: ${response.error.error}` });
    }
  };

  const onUnpublish = async () => {
    if (!window.confirm("公開を取り下げます。記事は読者から見えなくなります（下書きは残ります）。"))
      return;
    const response = await unpublish(latest.current.slug);
    if (response.ok) {
      setStatus("draft");
      setNotice({ kind: "ok", text: "公開を取り下げました" });
    } else {
      setNotice({ kind: "error", text: `取り下げられませんでした: ${response.error.error}` });
    }
  };

  const onDelete = async () => {
    if (
      !window.confirm(
        `「${latest.current.title || latest.current.slug}」を完全に削除します。履歴も消え、元に戻せません。よろしいですか？`,
      )
    )
      return;
    const response = await deletePost(latest.current.slug);
    if (response.ok) {
      // 削除した記事の画面に、未保存の警告を出さずに離れる。
      setSaveState("saved");
      window.location.href = "/admin";
    } else {
      setNotice({ kind: "error", text: `削除できませんでした: ${response.error.error}` });
    }
  };

  // 履歴から巻き戻したあと、サーバーの下書きを読み直して、画面に反映する。
  const onRestored = async () => {
    const response = await getPost(latest.current.slug);
    if (!response.ok) {
      setNotice({ kind: "error", text: "巻き戻したあとの下書きを読み込めませんでした" });
      return;
    }
    const restored = response.data;
    setTitle(restored.title);
    setDate(restored.date);
    setDescription(restored.description);
    setTags(restored.tags);
    setBody(restored.body);
    editor.current?.replaceAll(restored.body);
    setUnpublished(restored.hasUnpublishedChanges);
    setSaveState("saved");
    setHistoryOpen(false);
    setNotice({ kind: "ok", text: "下書きを巻き戻しました" });
  };

  const jumpTo = (offset: number) => {
    setTab("edit");
    // タブを切り替えて、エディタが表示されてから移動する。
    setTimeout(() => editor.current?.jumpTo(offset), 0);
  };

  return (
    <div className="admin-editor">
      <div className="admin-toolbar">
        <a href="/admin" className="admin-back">
          ← 記事一覧
        </a>
        <span className={`admin-status admin-status-${status}`}>
          {status === "published" ? "公開中" : "下書き"}
        </span>
        {status === "published" && unpublished && (
          <span className="admin-status admin-status-changed">未公開の変更あり</span>
        )}
        <span className={`admin-save admin-save-${saveState}`} role="status">
          {SAVE_LABEL[saveState]}
        </span>
        <span className="admin-spacer" />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!slugValid || saveState === "saving"}
        >
          保存
        </button>
        <button type="button" onClick={() => setHistoryOpen((open) => !open)} disabled={!created}>
          履歴
        </button>
        <button type="button" onClick={() => void onDelete()} disabled={!created}>
          削除
        </button>
        {status === "published" && (
          <>
            <a className="admin-button" href={`/posts/${slug}`} target="_blank" rel="noreferrer">
              公開ページ
            </a>
            <button type="button" onClick={() => void onUnpublish()}>
              取り下げ
            </button>
          </>
        )}
        <button
          type="button"
          className="admin-primary"
          onClick={() => void onPublish()}
          disabled={!slugValid || errorCount > 0 || saveState === "saving"}
          title={errorCount > 0 ? "エラーを直すと公開できます" : undefined}
        >
          {status === "published" ? "更新して公開" : "公開する"}
        </button>
      </div>

      {notice && (
        <p
          className={`admin-notice admin-notice-${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}

      <div className="admin-fields">
        <label className="admin-field">
          <span>タイトル</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="admin-field">
          <span>slug（URL）</span>
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            readOnly={created}
            aria-invalid={slug !== "" && !slugValid}
            placeholder="2026-10-18-my-post"
          />
          {slug !== "" && !slugValid && (
            <small className="admin-field-error">
              小文字の英数字とハイフンだけ（先頭・末尾・連続のハイフンは不可）
            </small>
          )}
          {created && <small>公開した URL が変わるので、作成後は変えられません</small>}
        </label>
        <label className="admin-field">
          <span>日付</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="admin-field admin-field-wide">
          <span>説明（一覧・検索・SNS に出ます）</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="admin-field admin-field-wide">
          <span>タグ</span>
          <TagInput tags={tags} onChange={setTags} />
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "edit"}
          onClick={() => setTab("edit")}
        >
          編集
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "preview"}
          onClick={() => setTab("preview")}
        >
          プレビュー
          {result.body.length + result.fields.length > 0 && (
            <span className={`admin-tab-count${errorCount > 0 ? " admin-tab-count-error" : ""}`}>
              {result.body.length + result.fields.length}
            </span>
          )}
        </button>
      </div>

      <div className="admin-main">
        {/* エディタは、プレビューに切り替えても作り直さない（カーソル・取り消し履歴を保つため、隠すだけ）。 */}
        <div hidden={tab !== "edit"}>
          <CodeEditor
            ref={editor}
            initialValue={body}
            onChange={setBody}
            diagnostics={result.body}
            onImages={(files) => void onImages(files)}
            onSave={() => void save()}
          />
        </div>
        {tab === "preview" && (
          <Preview
            title={title}
            date={date}
            tags={tags}
            result={result}
            onJump={jumpTo}
            serverErrors={serverErrors}
          />
        )}
        {historyOpen && created && (
          <HistoryPanel
            slug={slug}
            current={{ title, description, date, tags, body }}
            onClose={() => setHistoryOpen(false)}
            onRestored={() => void onRestored()}
          />
        )}
      </div>
    </div>
  );
}

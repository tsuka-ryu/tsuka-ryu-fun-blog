import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import type { BodyDiagnostic } from "#admin/diagnostics.js";

// 本文の Markdown エディタ（CodeMirror 6）。値の持ち主は親（Editor）で、ここは入力を通知し、
// 親の指示（挿入・置き換え・位置への移動・診断の印）を受ける。

export interface CodeEditorHandle {
  /** カーソルの位置に挿入する（選択範囲があれば置き換える）。 */
  insert(text: string): void;
  /** 本文をまるごと置き換える（履歴からの復元など）。 */
  replaceAll(text: string): void;
  /** 本文の位置へカーソルを移してスクロールする。 */
  jumpTo(offset: number): void;
  focus(): void;
}

interface Props {
  initialValue: string;
  onChange: (value: string) => void;
  /** エディタの該当位置に、エラー・警告の印を付ける。 */
  diagnostics: BodyDiagnostic[];
  /** 貼り付け・ドロップされた画像ファイル。 */
  onImages: (files: File[]) => void;
  onSave: () => void;
}

const imageFiles = (list: FileList | null | undefined): File[] =>
  [...(list ?? [])].filter((file) => file.type.startsWith("image/"));

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { initialValue, onChange, diagnostics, onImages, onSave },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // コールバックは最新のものを参照する（エディタは一度だけ作るので、閉じ込めないため）。
  const callbacks = useRef({ onChange, onImages, onSave });
  callbacks.current = { onChange, onImages, onSave };

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          lintGutter(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          placeholder("本文を Markdown で書く。画像は貼り付けかドラッグ&ドロップで入れられます。"),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste(event) {
              const files = imageFiles(event.clipboardData?.files);
              if (files.length === 0) return false;
              event.preventDefault();
              callbacks.current.onImages(files);
              return true;
            },
            drop(event) {
              const files = imageFiles(event.dataTransfer?.files);
              if (files.length === 0) return false;
              event.preventDefault();
              callbacks.current.onImages(files);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // エディタは一度だけ作る。値の更新は、ハンドルの replaceAll で行う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const length = editor.state.doc.length;
    const marks: CmDiagnostic[] = diagnostics.map((d) => ({
      from: Math.min(d.from, length),
      to: Math.min(Math.max(d.to, d.from + 1), length),
      severity: d.severity,
      message: d.message,
      source: d.ruleId,
    }));
    editor.dispatch(setDiagnostics(editor.state, marks));
  }, [diagnostics]);

  useImperativeHandle(ref, () => ({
    insert(text) {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch(editor.state.replaceSelection(text));
      editor.focus();
    },
    replaceAll(text) {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    },
    jumpTo(offset) {
      const editor = view.current;
      if (!editor) return;
      const at = Math.min(offset, editor.state.doc.length);
      editor.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "center" }),
      });
      editor.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div className="admin-codemirror" ref={host} />;
});

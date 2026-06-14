import {
  codeToTokens,
  bundledLanguages,
  type BundledLanguage,
  type SpecialLanguage,
  type ThemedToken,
} from "shiki";

import type { CSSProperties } from "react";

// サーバー（ビルド）環境だけで実行されるシンタックスハイライト。
//
// このモジュールは Server Component の CodeBlock からのみ import されるため、
// shiki は RSC ペイロード描画時のビルド時にだけ動き、クライアントには載らない
// （= ハイライトのクライアント JS 増加はゼロ）。
//
// 色を直書きせず CSS 変数でライト/ダークの両テーマを出力するので、
// サイトの prefers-color-scheme（ダークモード）に追従する
// （styles.css の --shiki-light / --shiki-dark 参照）。

const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";

export interface HighlightResult {
  /** トークン化された行。各トークンはテーマ別の色 CSS 変数を持つ。 */
  lines: ThemedToken[][];
  /** ルートの <pre> 用スタイル（背景の CSS 変数）。無ければ undefined。 */
  rootStyle?: CSSProperties;
}

function isBundledLanguage(lang: string): boolean {
  return Object.prototype.hasOwnProperty.call(bundledLanguages, lang);
}

/** "a:b;c:d" 形式の CSS 宣言文字列を React のスタイルオブジェクトに変換する。 */
function parseStyle(css: string | false | undefined): CSSProperties | undefined {
  if (!css) return undefined;
  const style: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (prop) style[prop] = value;
  }
  return style as CSSProperties;
}

// code をビルド時にハイライトし、トークン化された行とルート <pre> のスタイルを返す。
// 未知・未指定の言語はプレーンテキストにフォールバックし、未対応のコードフェンスで
// ビルドが壊れないようにする。
export async function highlight(code: string, lang: string | undefined): Promise<HighlightResult> {
  // isBundledLanguage で絞り込み済み。未対応・未指定は "text"（SpecialLanguage）。
  const safeLang: BundledLanguage | SpecialLanguage =
    lang && isBundledLanguage(lang) ? (lang as BundledLanguage) : "text";
  const { tokens, rootStyle } = await codeToTokens(code, {
    lang: safeLang,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
  return { lines: tokens, rootStyle: parseStyle(rootStyle) };
}

// ベースライン画像のファイル名から、旧サイト（FUNSTACK）で撮った URL の一覧を復元する。
// 移行前に存在した URL が、新しい環境でも見つかる（404 にならない）ことの確認に使う。

// 縦に長いページは `-1of2` のように分けて撮るので、ビューポート名のあとに分割の番号が付くことがある。
const SUFFIX = /-(?:desktop|mobile)(?:-\d+of\d+)?-chromium-linux\.png$/;
/** 旧サイトにもなく、わざと存在しない URL で撮った 404 の画面。 */
const NOT_FOUND_SLUG = "this-page-does-not-exist";

/** ベースライン画像のファイル名（`posts__x-desktop-chromium-linux.png` など）から、URL のパスを求める。 */
export function pathFromBaselineFile(file: string): string | null {
  if (!SUFFIX.test(file)) return null;
  const name = file.replace(SUFFIX, "");
  if (name === NOT_FOUND_SLUG) return null;
  return name === "home" ? "/" : `/${name.replaceAll("__", "/")}`;
}

export function pathsFromBaselines(files: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const path = pathFromBaselineFile(file);
    if (path) paths.add(path);
  }
  return [...paths].sort();
}

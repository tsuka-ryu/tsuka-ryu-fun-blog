"use client";

import { useEffect } from "react";

// クライアントのソフト遷移（@funstack/router のクライアントルーティング）後に
// document.title を確実に正しい値へ焼き直すための島。
//
// 背景: 各ページの <Seo> が出力する <title>/<meta> は React 19 の Document
// Metadata で <head> に巻き上げられるが、ソフト遷移時に前ページ分が除去され切らず
// 重複し、document.title が古い <title>（＝先頭ノード）を指したままになることがある。
// クローラは各ページのサーバー HTML を読むため影響しないが、ブラウザ自身の共有
// シート（Web Share）が読む document.title だけが古いタイトルのままになる。
//
// document.title への代入は重複した <title> があっても先頭ノードのテキストを
// 上書きするため、重複削除をせずともこの 1 行で共有シートのタイトルを正せる。
// タイトルはページが既に持つ値を prop で受け取るので、別系統のメタ定義は要らない。
export function TitleSync({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

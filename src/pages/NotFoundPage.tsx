import { Seo } from "#components/Seo.js";

// 404 ページ。PostPage / TagPage が記事・タグ未存在時にも描画する。
export function NotFoundPage() {
  return (
    <div className="page not-found-page">
      <Seo title="ページが見つかりません" noindex />
      <h1>404</h1>
      <p>お探しのページは見つかりませんでした。</p>
      <a href="/" className="back-link">
        &larr; ホームへ戻る
      </a>
    </div>
  );
}

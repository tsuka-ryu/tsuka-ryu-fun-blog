// 404 の本文。存在しない URL（pages/[...path]）と、存在しない記事・タグ（pages/posts/[slug]、pages/tags/[slug]）で使う。
export function NotFound() {
  return (
    <div className="page not-found-page">
      <h1>404</h1>
      <p>お探しのページは見つかりませんでした。</p>
      <a href="/" className="back-link">
        &larr; ホームへ戻る
      </a>
    </div>
  );
}

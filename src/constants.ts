// サイト全体で使う定数をまとめる。
// 後フェーズの SEO / RSS / ヘッダー等から参照する単一の定義元。

/** ブログのタイトル（RSS フィード・SEO・ヘッダー等で使用）。 */
export const SITE_TITLE = "tsuka-ryu fun blog";

/** サイトの説明（RSS の channel description・SEO の meta description 等で使用）。 */
export const SITE_DESCRIPTION = "tsuka-ryuの個人ブログ";

/** 本番のオリジン。canonical / OG / RSS / sitemap の絶対 URL を組み立てるのに使う。 */
export const SITE_URL = "https://tsuka-ryu.dev";

// サイト全体の基準タイムゾーン。サーバー（ビルド）もクライアント（ハイドレーション）も
// 必ずこの固定 TZ で時刻を扱い、環境依存（システム TZ）でブレないようにする。
// 時刻処理は src/lib/time.ts に集約し、Temporal.Now を裸で呼ばない。
export const SITE_TIME_ZONE = "Asia/Tokyo";

// サイト全体で使う定数をまとめる。
// 後フェーズの SEO / RSS / ヘッダー等から参照する単一の定義元。

/** ブログの正式タイトル（RSS フィード・SEO 等のメタ情報で使用）。 */
export const SITE_TITLE = "tsuka-ryu fun blog";

/** 画面に出すブランド名（ヘッダーのブランド・ホームのヒーロー見出し）。表示専用で、
 *  SEO/RSS には使わない。メタは長い SITE_TITLE、見た目は短い SITE_NAME と役割を分ける。 */
export const SITE_NAME = "tsuka-ryu";

/** サイトの説明（RSS の channel description・SEO の meta description 等で使用）。 */
export const SITE_DESCRIPTION = "tsuka-ryuの個人ブログ";

/** ホームのヒーローで名前の下に出すキャッチコピー（表示専用。SEO/RSS には使わない）。 */
export const SITE_CATCHPHRASE = "キーボードを叩く、何かが壊れる。";

/** フッターに置く結びの一言。カート・ヴォネガット『スローターハウス5』邦訳の合いの手で、
 *  キャッチコピーの「何かが壊れる。」に静かに呼応させる。表示専用。 */
export const FOOTER_SIGNOFF = "——そういうものだ。";

/** 本番のオリジン。canonical / OG / RSS / sitemap の絶対 URL を組み立てるのに使う。 */
export const SITE_URL = "https://tsuka-ryu.dev";

// サイト全体の基準タイムゾーン。サーバー（ビルド）もクライアント（ハイドレーション）も
// 必ずこの固定 TZ で時刻を扱い、環境依存（システム TZ）でブレないようにする。
// 時刻処理は src/lib/time.ts に集約し、Temporal.Now を裸で呼ばない。
export const SITE_TIME_ZONE = "Asia/Tokyo";

/** ヘッダーに並べるソーシャルリンク。アイコンは Header 側で key により出し分ける。 */
export const SOCIAL_LINKS = [
  { key: "github", label: "GitHub", url: "https://github.com/tsuka-ryu" },
  { key: "x", label: "X (Twitter)", url: "https://x.com/tsuka_ryu" },
  { key: "zenn", label: "Zenn", url: "https://zenn.dev/sushin_ya" },
] as const;

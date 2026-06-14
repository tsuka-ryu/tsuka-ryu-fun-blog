import { SITE_TIME_ZONE } from "#constants.js";
import { Temporal } from "temporal-polyfill-lite";

// アプリ全体の時刻処理をここに集約する。サーバー（ビルド）もクライアント
// （ハイドレーション）も必ず SITE_TIME_ZONE（JST）で扱い、環境依存の TZ で
// ブレないようにする。Temporal.Now はシステム TZ ではなく固定 TZ で呼ぶこと。

// 現在時刻を JST の ZonedDateTime で返す（システム TZ に依存しない）。
export function nowInTokyo(): Temporal.ZonedDateTime {
  return Temporal.Now.zonedDateTimeISO(SITE_TIME_ZONE);
}

// 記事日付（YYYY-MM-DD）を JST の 0 時の ZonedDateTime にする。
export function dateInTokyo(date: string): Temporal.ZonedDateTime {
  return Temporal.PlainDate.from(date).toZonedDateTime(SITE_TIME_ZONE);
}

// ISO 日付文字列（例: "2026-06-07"）を "2026年6月7日" 形式に整形する。
// PlainDate は TZ を持たない暦日そのものなので、表示はどの環境でも一致する。
// 日付の妥当性は content.ts の frontmatter 検証で担保済みのため、不正値は
// Temporal.PlainDate.from が RangeError を投げてビルドを失敗させる（握り潰さない）。
export function formatDate(date: string): string {
  const d = Temporal.PlainDate.from(date);
  return `${d.year}年${d.month}月${d.day}日`;
}

// ISO 日付文字列を "2026.06.07" 形式（ドット区切り・月日は 0 埋め）に整形する。
// 記事一覧で日付を左マージンに等幅で並べるとき、桁が揃って読みやすい。
export function formatDateDots(date: string): string {
  const d = Temporal.PlainDate.from(date);
  return `${d.year}.${pad2(d.month)}.${pad2(d.day)}`;
}

// RFC 822（RSS 2.0 が要求する日付形式）の曜日・月名（dayOfWeek は 1=月〜7=日）。
const RFC822_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RFC822_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ZonedDateTime を RFC 822 形式に整形する。オフセットは ZonedDateTime の実値
// （JST なら +0900）を使うため、GMT 固定にせず TZ をそのまま反映する。
export function toRfc822(zdt: Temporal.ZonedDateTime): string {
  const weekday = RFC822_WEEKDAYS[zdt.dayOfWeek - 1]!;
  const month = RFC822_MONTHS[zdt.month - 1]!;
  const time = `${pad2(zdt.hour)}:${pad2(zdt.minute)}:${pad2(zdt.second)}`;
  const offset = zdt.offset.replace(":", ""); // "+09:00" → "+0900"
  return `${weekday}, ${pad2(zdt.day)} ${month} ${zdt.year} ${time} ${offset}`;
}

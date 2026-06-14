"use client";

import { useEffect, useRef, useState } from "react";

// 生成された検索ランタイムが返す 1 件のヒット。
// ランタイムは score / matches も返すが、本コンポーネントでは使わないため
// 描画に必要なフィールドだけを宣言する（消費する形だけを assert）。
interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

interface SearchRuntime {
  search: (query: string) => Promise<SearchResult[]>;
}

// 全文検索ボックス。ox-content が生成するクライアントランタイム（/search.js、
// ビルドエントリが出力）を遅延ロードし、/search-index.json のインデックスに対して
// 問い合わせる。どちらの静的ファイルもビルド後のサイトにしか存在しないため、
// pnpm dev では無効状態にグレースフルにフォールバックする。
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const runtimeRef = useRef<SearchRuntime | null>(null);

  // マウント時に一度だけランタイムをロードする。指定子は実行時に組み立てることで、
  // バンドラに外部の動的 import として扱わせる（このファイルはクライアントバンドルの
  // 一部ではなく、ビルドエントリが出力する）。
  useEffect(() => {
    let active = true;
    const runtimeUrl = `${window.location.origin}/search.js`;
    import(/* @vite-ignore */ runtimeUrl)
      .then((mod) => {
        if (!active) return;
        runtimeRef.current = (mod.default ?? mod) as SearchRuntime;
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  // ランタイムへのデバウンス付きクエリ。
  useEffect(() => {
    const runtime = runtimeRef.current;
    const trimmed = query.trim();
    if (status !== "ready" || !runtime || !trimmed) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const hits = await runtime.search(trimmed);
      if (active) setResults(hits);
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, status]);

  const unavailable = status === "unavailable";
  const showResults = status === "ready" && query.trim().length > 0;

  return (
    <div className="search">
      <input
        type="search"
        className="search-input"
        placeholder={unavailable ? "検索はビルド後に利用できます" : "記事を検索..."}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={unavailable}
        aria-label="記事を検索"
      />
      {showResults && (
        <ul className="search-results">
          {results.length === 0 ? (
            <li className="search-empty">該当する記事がありません</li>
          ) : (
            results.map((result) => (
              <li key={result.id} className="search-result">
                <a href={result.url} onClick={() => setQuery("")}>
                  <span className="search-result-title">{result.title}</span>
                  {result.snippet && (
                    <span className="search-result-snippet">{result.snippet}</span>
                  )}
                </a>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

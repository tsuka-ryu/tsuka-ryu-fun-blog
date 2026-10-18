"use client";

import { searchDocuments, type SearchDocument, type SearchResult } from "#lib/search-query.js";
import { useEffect, useRef, useState } from "react";

// ヘッダーの検索欄。ブラウザで索引を読み込んで、入力のたびに（少し待ってから）検索する。
// ページは JavaScript なしで描画するので、これはアイランド（Header.tsx で `island: "load"`）として動く。
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const documentsRef = useRef<SearchDocument[]>([]);

  // 索引（サーバーが作る /search-index.json）を、最初に 1 回だけ読み込む。
  useEffect(() => {
    let active = true;
    fetch("/search-index.json")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<SearchDocument[]>)
          : Promise.reject(new Error(String(res.status))),
      )
      .then((documents) => {
        if (!active) return;
        documentsRef.current = documents;
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (status !== "ready" || !trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setResults(searchDocuments(documentsRef.current, trimmed));
    }, 120);
    return () => clearTimeout(timer);
  }, [query, status]);

  const unavailable = status === "unavailable";
  const showResults = status === "ready" && query.trim().length > 0;

  return (
    <div className="search">
      <input
        type="search"
        className="search-input"
        placeholder={unavailable ? "検索は準備中です" : "記事を検索..."}
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

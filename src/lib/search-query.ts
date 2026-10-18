// 記事の検索。ブラウザで動く（SearchBox から呼ぶ）。サーバーが公開時に作った索引（search-index.json）を
// 読み込んで、ブラウザの中で検索する。記事が数十〜数百本の規模なので、全文を部分一致で走査して十分。
// 日本語は単語の区切りがないので、形態素解析はせず、文字列の部分一致で探す。

export interface SearchDocument {
  id: string;
  title: string;
  url: string;
  headings: string[];
  body: string;
  code: string;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

/** 全角・半角や大文字・小文字の違いをならす。 */
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 70;

function snippetAround(text: string, normalizedText: string, term: string): string {
  const index = normalizedText.indexOf(term);
  if (index === -1) return "";
  const from = Math.max(0, index - SNIPPET_BEFORE);
  const to = Math.min(text.length, index + term.length + SNIPPET_AFTER);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/** 空白（全角を含む）で区切った語が、すべて含まれる記事を、関連の高い順に返す。 */
export function searchDocuments(
  documents: SearchDocument[],
  query: string,
  limit = 8,
): SearchResult[] {
  const terms = normalize(query)
    .split(/[\s　]+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const scored: Array<{ doc: SearchDocument; score: number; snippet: string }> = [];
  for (const doc of documents) {
    const title = normalize(doc.title);
    const headings = doc.headings.map(normalize);
    const body = normalize(doc.body);
    const code = normalize(doc.code);

    let score = 0;
    let snippet = "";
    let matchedAll = true;
    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore += title.startsWith(term) ? 15 : 10;
      if (headings.some((h) => h.includes(term))) termScore += 5;
      if (body.includes(term)) {
        // 本文に何度も出てくるほど、少しだけ高くする（上限つき）。
        termScore += 1 + Math.min(body.split(term).length - 1, 5) * 0.2;
        if (!snippet) snippet = snippetAround(doc.body, body, term);
      }
      if (code.includes(term)) termScore += 0.5;
      if (termScore === 0) {
        matchedAll = false;
        break;
      }
      score += termScore;
    }
    if (!matchedAll) continue;
    if (!snippet) snippet = doc.headings.find((h) => normalize(h).includes(terms[0] ?? "")) ?? "";
    scored.push({ doc, score, snippet });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .slice(0, limit)
    .map(({ doc, snippet }) => ({ id: doc.id, title: doc.title, url: doc.url, snippet }));
}

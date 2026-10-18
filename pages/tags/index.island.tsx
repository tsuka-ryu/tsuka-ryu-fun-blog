import { Page } from "#components/Page.js";

import SearchBox from "../../src/components/SearchBox.tsx" with { island: "load" };

import type { Props } from "./index.server.ts";

function TagsPage({ tags }: Props) {
  return (
    <div className="page tags-page">
      <h1>タグ一覧</h1>
      {tags.length === 0 ? (
        <p className="tagline">まだタグがありません。</p>
      ) : (
        <ul className="tag-cloud" aria-label="タグ一覧">
          {tags.map((t) => (
            <li key={t.slug}>
              <a href={`/tags/${t.slug}`} className="tag">
                {t.tag}
                <span className="tag-count">{t.count}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ヘッダーの検索欄は、このファイルでアイランドにして渡す（理由は #components/Page.js）。
export default function TagsPageWithFrame(props: React.ComponentProps<typeof TagsPage>) {
  return (
    <Page search={<SearchBox />}>
      <TagsPage {...props} />
    </Page>
  );
}

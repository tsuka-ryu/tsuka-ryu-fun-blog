import { NotFound } from "#components/NotFound.js";
import { Page } from "#components/Page.js";

import SearchBox from "../src/components/SearchBox.tsx" with { island: "load" };

function NotFoundPage() {
  return <NotFound />;
}

// ヘッダーの検索欄は、このファイルでアイランドにして渡す（理由は #components/Page.js）。
export default function NotFoundPageWithFrame() {
  return (
    <Page search={<SearchBox />}>
      <NotFoundPage />
    </Page>
  );
}

import { Page } from "#components/Page.js";

import SearchBox from "../src/components/SearchBox.tsx" with { island: "load" };
import ShaderGimmick from "../src/components/ShaderGimmick.tsx" with { island: "visible" };

function AboutPage() {
  return (
    <div className="page about-page">
      {/* 見出しの背後にシェーダーを低不透明度で敷き、ふちをぼかして地に馴染ませる。
          シェーダーは装飾なので支援技術からは隠す（aria-hidden）。 */}
      <header className="about-hero">
        <div className="about-hero-shader" aria-hidden="true">
          <ShaderGimmick />
        </div>
        <h1>About me</h1>
      </header>
      <section className="about-intro">
        <p>モダンなWeb技術が好きなフロントエンドエンジニアです。</p>
        <p>
          最新のエコシステム動向から、マネジメントを含めた広義のエンジニアリングまで、幅広く関心を持っています。RustやHaskellなどの言語にも興味があります。
        </p>
      </section>
    </div>
  );
}

// ヘッダーの検索欄は、このファイルでアイランドにして渡す（理由は #components/Page.js）。
export default function AboutPageWithFrame() {
  return (
    <Page search={<SearchBox />}>
      <AboutPage />
    </Page>
  );
}

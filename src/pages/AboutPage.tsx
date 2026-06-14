import { Seo } from "#components/Seo.js";
import ShaderGimmick from "#components/ShaderGimmick.js";

// About ページ。tsuka-ryu の自己紹介とシェーダーの島デモを置く。
// 内容は既存ブログ tsuka-ryu's blog の About と揃える。
export function AboutPage() {
  return (
    <div className="page about-page">
      <Seo
        title="About me"
        description="tsuka-ryu について。モダンなWeb技術が好きなフロントエンドエンジニアです。"
        path="/about"
      />
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

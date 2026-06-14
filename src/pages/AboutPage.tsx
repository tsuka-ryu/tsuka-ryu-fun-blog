import ShaderGimmick from "#components/ShaderGimmick.js";
import { Seo } from "#components/Seo.js";

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
      {/* シェーダーの島。フェーズ8で本文背後に重ねる全面背景にする想定。 */}
      <ShaderGimmick />
      <h1>About me</h1>
      <section className="about-intro">
        <p>モダンなWeb技術が好きなフロントエンドエンジニアです。</p>
        <p>
          最新のエコシステム動向から、マネジメントを含めた広義のエンジニアリングまで、幅広く関心を持っています。RustやHaskellなどの言語にも興味があります。
        </p>
      </section>
    </div>
  );
}

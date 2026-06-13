"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";

// Client Component の「島（island）」デモ。
// paper-design の GrainGradient（WebGL シェーダー）を背景として描画する。
// シェーダーはブラウザ専用なので、SSR 時とハイドレーション直後は描画せず、
// マウント後に少し遅延してから表示する（遅い端末で uniform 画像の読み込みが
// 間に合わず出るエラーを避けるため。参考: tsuka-ryu-s-blog の Gimmick 実装）。
export default function ShaderGimmick() {
  const [showShader, setShowShader] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowShader(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: 240 }}>
      {showShader && (
        <GrainGradient
          style={{ position: "absolute", inset: 0 }}
          colors={["#ff8800", "#ff6b6b", "#ff99aa"]}
          colorBack="#121212"
          softness={0.5}
          intensity={0.5}
          noise={0.5}
          shape="sphere"
          speed={2}
          scale={0.4}
          rotation={1}
          offsetX={0}
          offsetY={0}
        />
      )}
    </div>
  );
}

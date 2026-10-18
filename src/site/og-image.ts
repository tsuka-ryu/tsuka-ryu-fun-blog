import { ogInput } from "#og/input.js";
import { ogKey } from "#site/keys.js";

import type { PostFrontmatter } from "#content.js";
import type { OgCardProps } from "#og/OgCard.js";
import type { ObjectStore } from "#site/store.js";

// 記事の OG 画像の生成と保存。D1 に触れないので、公開時（#site/publish.js）と、公開側の取りこぼしの補完
// （middleware/04.og.ts）の両方から使える。

/** OG 画像を描画して R2 に置く。作れなかったときは、その理由を返す（例外は投げない）。 */
export async function writeOgImage(
  deps: {
    store: ObjectStore;
    renderOg?: (input: OgCardProps) => Promise<Uint8Array>;
  },
  slug: string,
  frontmatter: PostFrontmatter,
): Promise<string | undefined> {
  if (!deps.renderOg) return undefined;
  try {
    await deps.store.put(ogKey(slug), await deps.renderOg(ogInput(frontmatter)), "image/png");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

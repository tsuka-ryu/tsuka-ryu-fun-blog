import { storage } from "void/storage";

import type { ObjectStore } from "#site/store.js";

// R2（void/storage）の ObjectStore。Worker の中でだけ使う。

export const r2Store: ObjectStore = {
  async get(key) {
    const object = await storage.get(key);
    return object ? await object.text() : null;
  },

  async put(key, body, contentType) {
    await storage.put(key, body, { httpMetadata: { contentType } });
  },

  async delete(key) {
    await storage.delete(key);
  },

  async list(prefix) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.list({ prefix, cursor });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys;
  },
};

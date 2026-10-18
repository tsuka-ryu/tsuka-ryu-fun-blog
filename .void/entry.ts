import { _validateEnvOnce } from "/home/user/tsuka-ryu-fun-blog/node_modules/.pnpm/void@1.1.11_@types+node@24.13.2_arktype@2.2.8_kysely@0.29.6_react-dom@19.2.7_react@19.2_af68f4f94ccf256f7bc99389b887c32b/node_modules/void/dist/runtime/env-public.mjs";
import { withRuntimeEnv } from "/home/user/tsuka-ryu-fun-blog/node_modules/.pnpm/void@1.1.11_@types+node@24.13.2_arktype@2.2.8_kysely@0.29.6_react-dom@19.2.7_react@19.2_af68f4f94ccf256f7bc99389b887c32b/node_modules/void/dist/runtime/env.mjs";
import {
  filterInternalBindings as __filterBindings,
  createWorkerFetch as __createWorkerFetch,
} from "/home/user/tsuka-ryu-fun-blog/node_modules/.pnpm/void@1.1.11_@types+node@24.13.2_arktype@2.2.8_kysely@0.29.6_react-dom@19.2.7_react@19.2_af68f4f94ccf256f7bc99389b887c32b/node_modules/void/dist/runtime/routing.mjs";
import { WorkerEntrypoint } from "cloudflare:workers";
import app, {
  scheduled,
  __voidCollectPrerenderPaths,
  __voidHandleInternalRoute,
  __withRawEnv,
} from "virtual:void-routes";

import "/home/user/tsuka-ryu-fun-blog/env.ts";
const __filterInternalBindings = (env) => __filterBindings(env, ["__VOID_", "__PROJECT_"], []);
import { createAssetFallback as __createAssetFallback } from "/home/user/tsuka-ryu-fun-blog/node_modules/.pnpm/void@1.1.11_@types+node@24.13.2_arktype@2.2.8_kysely@0.29.6_react-dom@19.2.7_react@19.2_af68f4f94ccf256f7bc99389b887c32b/node_modules/void/dist/runtime/routing.mjs";
const serveWithAssets = __createAssetFallback({
  assetsDir: "assets",
  serveSpaFallback: false,
  notFound: "none",
});

const __voidFetch = __createWorkerFetch({
  app,
  assets: serveWithAssets,
  withRawEnv: __withRawEnv,
  withRuntimeEnv,
  filterBindings: __filterInternalBindings,
  internalRoute: __voidHandleInternalRoute,
  collectPrerenderPaths: __voidCollectPrerenderPaths,
  validateEnv: _validateEnvOnce,
});
async function handleScheduled(controller, env, ctx) {
  await _validateEnvOnce(env);
  const userEnv = __filterInternalBindings(env);
  return withRuntimeEnv(env, () => scheduled(controller, userEnv, ctx));
}

export default class extends WorkerEntrypoint {
  async fetch(request) {
    return __voidFetch(request, this.env, this.ctx);
  }
  async scheduled(controller) {
    return handleScheduled(controller, this.env, this.ctx);
  }
}

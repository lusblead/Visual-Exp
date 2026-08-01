import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const localCompanionUrl = process.env.VISUALIZED_EXP_COMPANION_URL;
const localCompanionToken = process.env.VISUALIZED_EXP_COMPANION_TOKEN;
const localBackendUrl = process.env.VISUALIZED_EXP_BACKEND_URL;
const localBackendToken = process.env.VISUALIZED_EXP_BACKEND_TOKEN;
const explanationContextTokenSecret =
  process.env.EXPLANATION_CONTEXT_TOKEN_SECRET;
const disableLocalInspector =
  process.env.VISUALIZED_EXP_DISABLE_LOCAL_INSPECTOR === "1";
const localWorkerVars: Record<string, string> = {};

if (localCompanionUrl && localCompanionToken) {
  localWorkerVars.VISUALIZED_EXP_COMPANION_URL = localCompanionUrl;
  localWorkerVars.VISUALIZED_EXP_COMPANION_TOKEN = localCompanionToken;
}

if (localBackendUrl) {
  localWorkerVars.VISUALIZED_EXP_BACKEND_URL = localBackendUrl;
}

if (localBackendToken) {
  localWorkerVars.VISUALIZED_EXP_BACKEND_TOKEN = localBackendToken;
}

if (explanationContextTokenSecret) {
  localWorkerVars.EXPLANATION_CONTEXT_TOKEN_SECRET =
    explanationContextTokenSecret;
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  vars: localWorkerVars,
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        // The local all-in-one launcher does not expose debugger controls.
        // Disabling its unused proxy also removes a Windows workerd startup race.
        inspectorPort: disableLocalInspector ? false : undefined,
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});

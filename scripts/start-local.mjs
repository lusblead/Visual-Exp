import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { readExplanationContextSecret } from "./read-explanation-context-secret.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const companionProject = resolve(
  projectRoot,
  "companion",
  "VisualizedExp.Companion",
  "VisualizedExp.Companion.csproj",
);
const backendProject = resolve(projectRoot, "backend", "pom.xml");
const companionToken = randomBytes(32).toString("base64url");
const backendToken = randomBytes(32).toString("base64url");
const requestedPort = readRequestedPort(process.env.PORT, "PORT");
const backendPort =
  readRequestedPort(process.env.BACKEND_PORT, "BACKEND_PORT") ?? 8080;
const companion = spawn(
  "dotnet",
  ["run", "--project", companionProject, "--configuration", "Release", "--no-launch-profile"],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      DOTNET_ENVIRONMENT: "Production",
      VISUALIZED_EXP_COMPANION_TOKEN: companionToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let web = null;
let backend = null;
let shuttingDown = false;
let readyTimer = setTimeout(() => {
  failStartup("The local credential companion did not become ready in time.");
}, 60_000);
readyTimer.unref();

const stdoutLines = createInterface({ input: companion.stdout });
stdoutLines.on("line", (line) => {
  const match = /^READY (http:\/\/127\.0\.0\.1:\d+)$/.exec(line.trim());
  if (match && !web) {
    clearTimeout(readyTimer);
    readyTimer = null;
    void startWeb(match[1]);
    return;
  }

  if (line.trim()) {
    process.stdout.write(`[companion] ${line}\n`);
  }
});

const stderrLines = createInterface({ input: companion.stderr });
stderrLines.on("line", (line) => {
  if (line.trim()) {
    process.stderr.write(`[companion] ${line}\n`);
  }
});

companion.once("error", () => {
  failStartup("Unable to start the Windows credential companion.");
});

companion.once("exit", (code) => {
  if (!shuttingDown) {
    shutdown(typeof code === "number" && code !== 0 ? code : 1);
  }
});

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

async function startWeb(companionUrl) {
  let explanationContextTokenSecret;
  try {
    explanationContextTokenSecret = await readExplanationContextSecret(
      companionUrl,
      companionToken,
    );
  } catch {
    failStartup(
      "The local explanation-context secret could not be loaded securely.",
    );
    return;
  }

  const backendMasterKey =
    process.env.APP_CREDENTIAL_MASTER_KEY?.trim() ||
    process.env.APP_MASTER_KEY_BASE64?.trim() ||
    deriveBackendMasterKey(explanationContextTokenSecret);
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  try {
    await startBackend(backendUrl, backendMasterKey, companionUrl);
  } catch {
    failStartup("The Java backend did not become ready in time.");
    return;
  }

  process.stdout.write(`Local credential companion ready at ${companionUrl}\n`);
  process.stdout.write(`Java backend ready at ${backendUrl}\n`);
  const webCommand = requestedPort
    ? `npm run dev -- --port ${requestedPort}`
    : "npm run dev";
  web = spawn(webCommand, {
    cwd: projectRoot,
    env: {
      ...process.env,
      EXPLANATION_MODEL_PROVIDER: "deepseek",
      VISUALIZED_EXP_COMPANION_URL: companionUrl,
      VISUALIZED_EXP_COMPANION_TOKEN: companionToken,
      EXPLANATION_CONTEXT_TOKEN_SECRET: explanationContextTokenSecret,
      VISUALIZED_EXP_BACKEND_URL: backendUrl,
      VISUALIZED_EXP_BACKEND_TOKEN: backendToken,
      VISUALIZED_EXP_DISABLE_LOCAL_INSPECTOR: "1",
    },
    shell: true,
    stdio: "inherit",
    windowsHide: true,
  });

  web.once("error", () => {
    process.stderr.write("Unable to start the local web application.\n");
    shutdown(1);
  });
  web.once("exit", (code) => {
    if (!shuttingDown) {
      shutdown(typeof code === "number" ? code : 1);
    }
  });
}

async function startBackend(backendUrl, masterKey, companionUrl) {
  const mavenArgs = ["-f", backendProject, "spring-boot:run"];
  const mavenCommand = process.platform === "win32" ? "cmd.exe" : "mvn";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "mvn.cmd", ...mavenArgs]
      : mavenArgs;
  backend = spawn(
    mavenCommand,
    commandArgs,
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(backendPort),
        APP_BIND_ADDRESS: "127.0.0.1",
        APP_CREDENTIAL_MASTER_KEY: masterKey,
        APP_INTERNAL_TOKEN: backendToken,
        APP_LOCAL_COMPANION_ENABLED: "true",
        APP_LOCAL_COMPANION_URL: companionUrl,
        APP_LOCAL_COMPANION_TOKEN: companionToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const backendStdout = createInterface({ input: backend.stdout });
  backendStdout.on("line", (line) => {
    if (line.trim()) process.stdout.write(`[backend] ${line}\n`);
  });
  const backendStderr = createInterface({ input: backend.stderr });
  backendStderr.on("line", (line) => {
    if (line.trim()) process.stderr.write(`[backend] ${line}\n`);
  });
  backend.once("error", () => {
    if (!shuttingDown) failStartup("Unable to start the Java backend.");
  });
  backend.once("exit", (code) => {
    if (!shuttingDown) {
      shutdown(typeof code === "number" && code !== 0 ? code : 1);
    }
  });

  const deadline = Date.now() + 120_000;
  while (!shuttingDown && Date.now() < deadline) {
    try {
      const response = await fetch(`${backendUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // Maven may still be compiling or the server may still be binding.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  throw new Error("backend readiness timeout");
}

function deriveBackendMasterKey(explanationContextTokenSecret) {
  return createHmac(
    "sha256",
    Buffer.from(explanationContextTokenSecret, "utf8"),
  )
    .update("visualized-exp/provider-credential-master-key/v1", "utf8")
    .digest("base64");
}

function readRequestedPort(value, name) {
  if (value == null || value === "") return null;
  if (!/^[1-9]\d{0,4}$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  const port = Number(value);
  if (port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function failStartup(message) {
  if (shuttingDown) return;
  process.stderr.write(`${message}\n`);
  shutdown(1);
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }

  terminateTree(web);
  terminateTree(backend);
  terminateTree(companion);
  setTimeout(() => process.exit(exitCode), 150).unref();
}

function terminateTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.unref();
    return;
  }

  child.kill("SIGTERM");
}

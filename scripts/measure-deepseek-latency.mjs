import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const companionProject = resolve(
  projectRoot,
  "companion",
  "VisualizedExp.Companion",
  "VisualizedExp.Companion.csproj",
);
const companionDllName = "VisualizedExp.Companion.dll";
const fixedModel = "deepseek-v4-pro";
const termModel = "deepseek-v4-flash";
const fixedQuestion =
  "请分层解释 Agent 与 RAG 如何协作构成可靠的知识问答系统。";
const fixedStreamMessages = [
  {
    role: "user",
    content:
      "Return one compact JSON object that names three high-level parts of a reliable knowledge system.",
  },
];
const maximumCapturedProcessOutput = 32_768;
const maximumErrorResponseBytes = 65_536;
let probeStage = "initialization";

class ProbeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "ProbeFailure";
    this.code = code;
  }
}

const ownedResources = [];

try {
  probeStage = "configuration";
  const attached = readAttachedConfiguration();
  probeStage = "local_stack";
  const configuration = attached ?? (await startIsolatedStack());
  probeStage = "credential_status";
  await requireConfiguredCredential(configuration);

  const metrics = [];
  const sessionId = randomUUID().replaceAll("-", "");
  probeStage = "lineage_create";
  const created = await measureLineageAction(
    configuration.webUrl,
    {
      action: "create",
      question: fixedQuestion,
      sessionId,
    },
    "create",
    fixedModel,
  );
  metrics.push(created.metric);

  const expansionTarget = selectExpansionTarget(created.payload?.document);
  probeStage = "lineage_expand";
  const expanded = await measureLineageAction(
    configuration.webUrl,
    {
      action: "expand",
      document: created.payload.document,
      nodeId: expansionTarget,
      sessionId,
    },
    "expand",
    fixedModel,
  );
  metrics.push(expanded.metric);

  const definitionTarget = selectDefinitionTarget(expanded.payload?.document);
  probeStage = "lineage_define";
  const defined = await measureLineageAction(
    configuration.webUrl,
    {
      action: "define",
      document: expanded.payload.document,
      nodeId: definitionTarget.nodeId,
      term: definitionTarget.term,
      sessionId,
    },
    "define",
    termModel,
  );
  metrics.push(defined.metric);

  probeStage = "companion_stream_pro";
  metrics.push(
    await measureCompanionStream(
      configuration.companionUrl,
      configuration.companionToken,
      fixedModel,
    ),
  );
  probeStage = "companion_stream_flash";
  metrics.push(
    await measureCompanionStream(
      configuration.companionUrl,
      configuration.companionToken,
      termModel,
    ),
  );

  process.stdout.write(`${JSON.stringify({ metrics }, null, 2)}\n`);
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(
    `${JSON.stringify({
      error: {
        code:
          error instanceof ProbeFailure
            ? error.code
            : `${probeStage}_failed`,
      },
    })}\n`,
  );
} finally {
  for (const cleanup of ownedResources.reverse()) {
    try {
      await cleanup();
    } catch {
      // Cleanup errors must not replace or disclose measurement output.
    }
  }
}

function readAttachedConfiguration() {
  const rawWebUrl = process.env.VISUALIZED_EXP_WEB_URL?.trim();
  const rawCompanionUrl = process.env.VISUALIZED_EXP_COMPANION_URL?.trim();
  const companionToken = process.env.VISUALIZED_EXP_COMPANION_TOKEN?.trim();
  const suppliedCount = [rawWebUrl, rawCompanionUrl, companionToken].filter(
    Boolean,
  ).length;

  if (suppliedCount === 0) return null;
  if (suppliedCount !== 3) {
    throw new ProbeFailure("incomplete_local_transport");
  }

  return {
    webUrl: requireLoopbackOrigin(rawWebUrl),
    companionUrl: requireLoopbackOrigin(rawCompanionUrl),
    companionToken,
  };
}

async function startIsolatedStack() {
  if (process.platform !== "win32") {
    throw new ProbeFailure("windows_companion_required");
  }

  probeStage = "build_output_directory";
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "visualized-exp-latency-"),
  );
  ownedResources.push(async () => {
    await rm(outputDirectory, { recursive: true, force: true });
  });

  probeStage = "companion_build";
  await runQuiet(
    "dotnet",
    [
      "build",
      companionProject,
      "--configuration",
      "Release",
      "--nologo",
      "--output",
      outputDirectory,
      "-p:UseAppHost=false",
    ],
    120_000,
    "companion_build_failed",
  );

  probeStage = "companion_start";
  const companionToken = randomBytes(32).toString("base64url");
  const companion = spawn("dotnet", [resolve(outputDirectory, companionDllName)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DOTNET_ENVIRONMENT: "Production",
      VISUALIZED_EXP_COMPANION_TOKEN: companionToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const companionOutput = captureProcessOutput(companion);
  ownedResources.push(() => stopProcessTree(companion));
  probeStage = "companion_ready";
  const companionUrl = await waitForCompanion(companion, companionOutput);

  probeStage = "web_port";
  const webPort = await reserveLoopbackPort();
  probeStage = "web_start";
  const vinextCli = resolve(
    projectRoot,
    "node_modules",
    "vinext",
    "dist",
    "cli.js",
  );
  const web = spawn(
    process.execPath,
    [vinextCli, "dev", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        EXPLANATION_MODEL_PROVIDER: "deepseek",
        VISUALIZED_EXP_COMPANION_URL: companionUrl,
        VISUALIZED_EXP_COMPANION_TOKEN: companionToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  captureProcessOutput(web);
  ownedResources.push(() => stopProcessTree(web));

  const webUrl = `http://localhost:${webPort}`;
  probeStage = "web_ready";
  await waitForWeb(web, webUrl);
  return { webUrl, companionUrl, companionToken };
}

async function requireConfiguredCredential(configuration) {
  let response;
  try {
    response = await fetch(`${configuration.companionUrl}/v1/status`, {
      headers: {
        Authorization: `Bearer ${configuration.companionToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProbeFailure("local_companion_unavailable");
  }

  const payload = await readBoundedJson(response, maximumErrorResponseBytes);
  if (!response.ok) {
    throw new ProbeFailure(readSafeErrorCode(payload, "local_companion_failed"));
  }
  if (payload?.configured !== true) {
    throw new ProbeFailure("credential_required");
  }
}

async function measureLineageAction(
  webUrl,
  body,
  action,
  expectedModel,
) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(`${webUrl}/api/lineage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(210_000),
    });
  } catch {
    throw new ProbeFailure("lineage_request_failed");
  }

  const raw = await readBoundedText(response, 8_388_608);
  const totalMs = elapsedMilliseconds(startedAt);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new ProbeFailure("lineage_response_invalid");
  }
  if (!response.ok) {
    throw new ProbeFailure(readSafeErrorCode(payload, "lineage_request_failed"));
  }
  if (payload?.model !== expectedModel) {
    throw new ProbeFailure(`unexpected_${action}_model`);
  }
  if (action === "define") {
    if (
      !payload.explanation ||
      typeof payload.explanation !== "object" ||
      typeof payload.explanation.definition !== "string" ||
      payload.explanation.definition.trim().length === 0
    ) {
      throw new ProbeFailure("lineage_define_unusable");
    }
  } else if (
    !payload.document ||
    typeof payload.document !== "object" ||
    !Array.isArray(payload.document.nodes) ||
    payload.document.nodes.length === 0
  ) {
    throw new ProbeFailure(`lineage_${action}_unusable`);
  }

  return {
    payload,
    metric: {
      action,
      model: safeModelName(payload.model, expectedModel),
      ttftMs: null,
      totalMs,
      finishReason: "accepted",
      contentLength: Buffer.byteLength(raw, "utf8"),
    },
  };
}

async function measureCompanionStream(companionUrl, companionToken, modelName) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(
      `${companionUrl}/v1/deepseek/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${companionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: fixedStreamMessages,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: 192,
          stream: true,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch {
    throw new ProbeFailure("companion_stream_failed");
  }

  if (!response.ok) {
    const payload = await readBoundedJson(response, maximumErrorResponseBytes);
    throw new ProbeFailure(
      readSafeErrorCode(payload, "companion_stream_failed"),
    );
  }
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("text/event-stream")
  ) {
    throw new ProbeFailure("companion_stream_unavailable");
  }
  if (!response.body) {
    throw new ProbeFailure("companion_stream_unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let ttftMs = null;
  let contentLength = 0;
  let finishReason = null;
  let model = modelName;
  let sawDone = false;

  while (!sawDone) {
    const { done, value } = await reader.read();
    lineBuffer += decoder.decode(value, { stream: !done });
    const lines = lineBuffer.split("\n");
    lineBuffer = done ? "" : (lines.pop() ?? "");

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trimStart();
      if (data === "[DONE]") {
        sawDone = true;
        break;
      }

      let event;
      try {
        event = JSON.parse(data);
      } catch {
        throw new ProbeFailure("companion_stream_invalid");
      }

      model = safeModelName(event?.model, model);
      const choice = Array.isArray(event?.choices) ? event.choices[0] : null;
      const content =
        typeof choice?.delta?.content === "string"
          ? choice.delta.content
          : "";
      if (content.length > 0) {
        if (ttftMs === null) ttftMs = elapsedMilliseconds(startedAt);
        contentLength += Buffer.byteLength(content, "utf8");
      }
      if (typeof choice?.finish_reason === "string") {
        finishReason = safeFinishReason(choice.finish_reason);
      }
    }

    if (done) break;
  }

  if (sawDone) {
    await reader.cancel();
  }
  if (ttftMs === null) {
    throw new ProbeFailure("companion_stream_empty");
  }

  return {
    action: "stream_probe",
    model,
    ttftMs,
    totalMs: elapsedMilliseconds(startedAt),
    finishReason: finishReason ?? (sawDone ? "done" : "connection_closed"),
    contentLength,
  };
}

function selectExpansionTarget(document) {
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray(document.nodes)
  ) {
    throw new ProbeFailure("lineage_create_unusable");
  }
  const nodes = new Map(
    document.nodes
      .filter((node) => node && typeof node === "object")
      .map((node) => [node.id, node]),
  );
  const root = nodes.get(document.rootId);
  const orderedCandidates = [
    ...(Array.isArray(root?.childIds) ? root.childIds : []),
    ...document.nodes.map((node) => node?.id),
  ];
  for (const nodeId of orderedCandidates) {
    const node = nodes.get(nodeId);
    if (
      node?.expandable === true &&
      node.expansionState !== "terminal" &&
      Array.isArray(node.childIds) &&
      node.childIds.length === 0
    ) {
      return node.id;
    }
  }
  throw new ProbeFailure("lineage_expand_target_missing");
}

function selectDefinitionTarget(document) {
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray(document.nodes)
  ) {
    throw new ProbeFailure("lineage_expand_unusable");
  }
  const orderedNodes = [...document.nodes].sort(
    (left, right) =>
      Number(right?.depth ?? 0) - Number(left?.depth ?? 0),
  );
  for (const node of orderedNodes) {
    if (typeof node?.id !== "string" || !Array.isArray(node.terms)) continue;
    const term = node.terms.find(
      (candidate) =>
        typeof candidate === "string" && candidate.trim().length > 0,
    );
    if (term) return { nodeId: node.id, term };
  }
  throw new ProbeFailure("lineage_define_target_missing");
}

function safeModelName(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value)
    ? value
    : fallback;
}

function safeFinishReason(value) {
  return /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : "unknown";
}

function readSafeErrorCode(payload, fallback) {
  const nested =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.error &&
    typeof payload.error === "object" &&
    !Array.isArray(payload.error)
      ? payload.error
      : payload;
  return typeof nested?.code === "string" &&
    /^[A-Za-z0-9._-]{1,80}$/.test(nested.code)
    ? nested.code
    : fallback;
}

async function readBoundedJson(response, maximumBytes) {
  const raw = await readBoundedText(response, maximumBytes);
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readBoundedText(response, maximumBytes) {
  if (
    Number.isFinite(Number(response.headers.get("content-length"))) &&
    Number(response.headers.get("content-length")) > maximumBytes
  ) {
    throw new ProbeFailure("response_too_large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ProbeFailure("response_too_large");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function runQuiet(command, args, timeoutMs, failureCode) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  captureProcessOutput(child);
  const result = await waitForExit(child, timeoutMs);
  if (result !== 0) throw new ProbeFailure(failureCode);
}

function captureProcessOutput(child) {
  const state = { output: "", spawnFailed: false };
  const append = (chunk) => {
    state.output = `${state.output}${chunk.toString("utf8")}`.slice(
      -maximumCapturedProcessOutput,
    );
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", () => {
    state.spawnFailed = true;
  });
  return state;
}

async function waitForCompanion(child, state) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = /READY (http:\/\/127\.0\.0\.1:\d+)/.exec(state.output);
    if (match) return requireLoopbackOrigin(match[1]);
    if (state.spawnFailed || child.exitCode !== null) {
      throw new ProbeFailure("companion_start_failed");
    }
    await delay(25);
  }
  throw new ProbeFailure("companion_start_timeout");
}

async function waitForWeb(child, webUrl) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new ProbeFailure("web_start_failed");
    }
    try {
      const response = await fetch(`${webUrl}/api/model-settings`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
    } catch {
      // The local web server is still starting.
    }
    await delay(100);
  }
  throw new ProbeFailure("web_start_timeout");
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new ProbeFailure("web_port_unavailable");
  }
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function requireLoopbackOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProbeFailure("invalid_local_origin");
  }
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ProbeFailure("invalid_local_origin");
  }
  return parsed.origin;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolveExit) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolveExit(null);
    }, timeoutMs);
    timer.unref();
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExit(code);
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExit(null);
    });
  });
}

async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    await waitForExit(killer, 5_000);
    return;
  }
  child.kill("SIGTERM");
  await waitForExit(child, 5_000);
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

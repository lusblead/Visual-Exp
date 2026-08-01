import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  combineCallSummaries,
  firstPreparedMilliseconds,
  relativeToOldFull,
  sanitizeUsageEvents,
  summarizeCalls,
} from "../evals/token-economy/live-compare-summary.mjs";

test("CLI startup failures preserve their safe error code", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      new URL(
        "../evals/token-economy/live-compare.mjs",
        import.meta.url,
      ).pathname.replace(/^\/([A-Za-z]:)/u, "$1"),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, VISUALIZED_EXP_WEB_URL: "" },
      windowsHide: true,
    },
  );

  assert.equal(result.status, 1);
  assert.deepEqual(parseLastJsonLine(result.stderr), {
    status: "fatal",
    errorCode: "dataset_required",
  });
  assert.doesNotMatch(result.stderr, /ReferenceError|CliError/);
});

function call({
  action = "expand",
  status = "success",
  durationMs = 100,
  totalTokens = 100,
  usage = true,
} = {}) {
  return {
    action,
    status,
    durationMs,
    providerUsage: usage
      ? sanitizeUsageEvents([
          {
            provider: "deepseek",
            model: "deepseek-v4-pro",
            phase: "primary",
            providerAttempt: 1,
            usage: {
              promptTokens: Math.max(0, totalTokens - 20),
              completionTokens: 20,
              totalTokens,
              promptCacheHitTokens: 0,
              promptCacheMissTokens: Math.max(0, totalTokens - 20),
            },
          },
        ])
      : [],
  };
}

test("shared create is included in end-to-end totals but excluded from relative profile savings", () => {
  const shared = summarizeCalls([
    call({ action: "create", durationMs: 700, totalTokens: 500 }),
  ]);
  const oldFull = summarizeCalls(
    Array.from({ length: 10 }, () => call({ totalTokens: 100 })),
  );
  const balanced = summarizeCalls([
    call({ action: "expand", durationMs: 400, totalTokens: 120 }),
    call({
      action: "define_batch",
      durationMs: 200,
      totalTokens: 80,
    }),
  ]);

  assert.deepEqual(relativeToOldFull(oldFull, balanced), {
    callCountSaved: 8,
    callSavingsRate: 0.8,
    totalTokensSaved: 800,
    totalTokenSavingsRate: 0.8,
  });
  const total = combineCallSummaries(shared, balanced);
  assert.equal(total.callCount, 3);
  assert.equal(total.fields.totalTokens.reportedTokens, 700);
  assert.equal(total.durationMs, 1300);
});

test("missing provider usage remains unknown and suppresses token-savings claims", () => {
  const oldFull = summarizeCalls([call({ usage: false })]);
  const onDemand = summarizeCalls([]);

  assert.equal(oldFull.fields.totalTokens.reportedTokens, 0);
  assert.equal(oldFull.fields.totalTokens.unknownCalls, 1);
  assert.deepEqual(relativeToOldFull(oldFull, onDemand), {
    callCountSaved: 1,
    callSavingsRate: 1,
    totalTokensSaved: null,
    totalTokenSavingsRate: null,
  });
});

test("firstPreparedMs is the 250ms scheduler delay plus the first successful scene request", () => {
  assert.equal(
    firstPreparedMilliseconds([
      call({ action: "expand", durationMs: 432.56 }),
      call({ action: "define_batch", durationMs: 100 }),
    ]),
    682.6,
  );
  assert.equal(firstPreparedMilliseconds([]), null);
  assert.equal(
    firstPreparedMilliseconds([
      call({ action: "expand", status: "failure", durationMs: 100 }),
    ]),
    null,
  );
});

test("repair attempts are aggregated as official provider usage from one logical call", () => {
  const measured = summarizeCalls([
    {
      action: "expand",
      status: "success",
      durationMs: 900,
      providerUsage: sanitizeUsageEvents([
        {
          provider: "deepseek",
          model: "deepseek-v4-pro",
          phase: "primary",
          providerAttempt: 1,
          usage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            promptCacheHitTokens: null,
            promptCacheMissTokens: 100,
          },
        },
        {
          provider: "deepseek",
          model: "deepseek-v4-pro",
          phase: "repair",
          providerAttempt: 1,
          usage: {
            promptTokens: 80,
            completionTokens: 30,
            totalTokens: 110,
            promptCacheHitTokens: 20,
            promptCacheMissTokens: 60,
          },
        },
      ]),
    },
  ]);

  assert.equal(measured.fields.totalTokens.reportedTokens, 230);
  assert.equal(measured.fields.totalTokens.unknownCalls, 0);
  assert.equal(measured.fields.promptCacheHitTokens.reportedTokens, 20);
  assert.equal(measured.fields.promptCacheHitTokens.unknownCalls, 1);
});

test("live runner reuses one sample session and durably appends each completed record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "visual-token-live-"));
  const datasetPath = join(directory, "cases.jsonl");
  const outputPath = join(directory, "result.jsonl");
  const requestBodies = [];
  let firstExpandStarted;
  const firstExpandPromise = new Promise((resolve) => {
    firstExpandStarted = resolve;
  });
  let releaseFirstExpand;
  const releaseFirstExpandPromise = new Promise((resolve) => {
    releaseFirstExpand = resolve;
  });
  let heldFirstExpand = false;
  const document = fixtureDocument();

  await writeFile(
    datasetPath,
    `${JSON.stringify({
      id: "session-output-01",
      question: "A safe integration fixture",
    })}\n`,
    "utf8",
  );

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requestBodies.push(body);

    if (body.action === "expand" && !heldFirstExpand) {
      heldFirstExpand = true;
      firstExpandStarted();
      await releaseFirstExpandPromise;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        document,
        provider: "fixture",
        model: "fixture-model",
        usage: [],
      }),
    );
  });

  try {
    await listen(server);
    const address = server.address();
    assert(address && typeof address === "object");
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        liveRunnerPath(),
        "--dataset",
        datasetPath,
        "--output",
        outputPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          VISUALIZED_EXP_WEB_URL: `http://127.0.0.1:${address.port}`,
        },
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    try {
      await withTimeout(firstExpandPromise, 5_000);
      const earlyRecords = readJsonLines(await readFile(outputPath, "utf8"));
      assert.deepEqual(
        earlyRecords.map((record) => record.profile),
        ["shared_create"],
      );
    } finally {
      releaseFirstExpand();
    }

    assert.equal(await childExit(child), 0, stderr);
    const source = await readFile(outputPath, "utf8");
    const records = readJsonLines(source);
    assert.deepEqual(
      records.map((record) => record.profile),
      ["shared_create", "old_full", "on_demand", "balanced", "deep"],
    );
    assert.equal(new Set(requestBodies.map((body) => body.sessionId)).size, 1);
    assert.doesNotMatch(
      source,
      /A safe integration fixture|VISUALIZED_EXP_WEB_URL|api[_-]?key/iu,
    );

    const beforeExclusiveRetry = source;
    const duplicateOutput = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        liveRunnerPath(),
        "--dataset",
        datasetPath,
        "--output",
        outputPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          VISUALIZED_EXP_WEB_URL: `http://127.0.0.1:${address.port}`,
        },
        windowsHide: true,
      },
    );
    assert.equal(duplicateOutput.status, 1);
    assert.deepEqual(parseLastJsonLine(duplicateOutput.stderr), {
      status: "fatal",
      errorCode: "output_exists",
    });
    assert.equal(await readFile(outputPath, "utf8"), beforeExclusiveRetry);
  } finally {
    releaseFirstExpand();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

function liveRunnerPath() {
  return new URL(
    "../evals/token-economy/live-compare.mjs",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/u, "$1");
}

function fixtureDocument() {
  return {
    protocol: "visual-explanation-document/2",
    id: "fixture-document",
    question: "fixture",
    rootId: "root",
    title: "Fixture",
    thesis: "Fixture thesis",
    version: 1,
    nodes: [
      {
        id: "root",
        parentId: null,
        childIds: ["child"],
        depth: 0,
        title: "Root",
        summary: "Root summary",
        detail: "Root detail",
        terms: [],
        expandable: true,
        expansionState: "expanded",
      },
      {
        id: "child",
        parentId: "root",
        childIds: [],
        depth: 1,
        title: "Child",
        summary: "Child summary",
        detail: "Child detail",
        terms: [],
        expandable: true,
        expansionState: "unexpanded",
      },
    ],
    relations: [],
  };
}

function readJsonLines(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function parseLastJsonLine(source) {
  const lines = source.split(/\r?\n/u).filter((line) => line.trim());
  return JSON.parse(lines.at(-1));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timeoutId),
  );
}

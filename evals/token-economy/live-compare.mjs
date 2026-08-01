import { appendFile, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildScenePrefetchQueue } from "../../lib/scene-prefetch-priority.mjs";
import { buildTermPrefetchBatches } from "../../lib/term-prefetch-priority.mjs";
import {
  PROFILE_LIMITS,
  combineCallSummaries,
  firstPreparedMilliseconds,
  relativeToOldFull,
  sanitizeUsageEvents,
  summarizeCalls,
} from "./live-compare-summary.mjs";

const OUTPUT_PROTOCOL = "visual-token-live-comparison/1";
const PROFILE_ORDER = Object.freeze([
  "old_full",
  "on_demand",
  "balanced",
  "deep",
]);
const DEFAULT_TIMEOUT_MS = 180_000;
const bufferedRecords = [];
let recordOutputPath = null;

class CliError extends Error {
  constructor(code) {
    super(code);
    this.name = "CliError";
    this.code = code;
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
  } else {
    await runComparison(options);
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: "fatal",
      errorCode: safeFatalCode(error),
    })}\n`,
  );
  process.exitCode = 1;
}

async function runComparison(options) {
  await initializeRecordOutput(options.outputPath);
  const endpoint = lineageEndpoint(process.env.VISUALIZED_EXP_WEB_URL);
  const allCases = await readJsonLines(options.datasetPath);
  const cases = selectCases(allCases, options.caseIds);

  for (const testCase of cases) {
    for (
      let sampleIndex = 1;
      sampleIndex <= testCase.repeatCount;
      sampleIndex += 1
    ) {
      process.stderr.write(
        `running case=${testCase.id} sample=${sampleIndex}/${testCase.repeatCount}\n`,
      );
      await runSample({
        endpoint,
        testCase,
        sampleIndex,
        timeoutMs: options.timeoutMs,
      });
      await flushBufferedRecords();
    }
  }
  await flushBufferedRecords();
}

async function runSample({
  endpoint,
  testCase,
  sampleIndex,
  timeoutMs,
}) {
  const sharedSessionId = createSessionId();
  const createResult = await requestLineage({
    endpoint,
    action: "create",
    body: {
      action: "create",
      question: testCase.question,
      sessionId: sharedSessionId,
    },
    timeoutMs,
  });
  const sharedCreateCall = { ...createResult.call, ordinal: 1 };
  const sharedSummary = summarizeCalls([sharedCreateCall]);
  writeRecord({
    protocol: OUTPUT_PROTOCOL,
    caseId: testCase.id,
    sampleIndex,
    profile: "shared_create",
    runStatus:
      createResult.call.status === "success" ? "completed" : "failed",
    initialCreateIsCommonCost: true,
    calls: [sharedCreateCall],
    summary: sharedSummary,
  });
  await flushBufferedRecords();

  if (createResult.call.status !== "success") {
    for (const profile of PROFILE_ORDER) {
      writeRecord({
        protocol: OUTPUT_PROTOCOL,
        caseId: testCase.id,
        sampleIndex,
        profile,
        runStatus: "skipped_common_create_failed",
        initialCreateIsCommonCost: true,
        calls: [],
        summary: null,
      });
      await flushBufferedRecords();
    }
    return;
  }

  const rootDocument = createResult.document;
  let oldFullSummary = null;
  for (const profile of PROFILE_ORDER) {
    const branch = await runProfileBranch({
      endpoint,
      rootDocument: structuredClone(rootDocument),
      profile,
      timeoutMs,
      sessionId: sharedSessionId,
    });
    const incremental = summarizeCalls(branch.calls);
    if (profile === "old_full") oldFullSummary = incremental;
    if (oldFullSummary === null) {
      throw new CliError("old_full_summary_missing");
    }
    writeRecord({
      protocol: OUTPUT_PROTOCOL,
      caseId: testCase.id,
      sampleIndex,
      profile,
      runStatus:
        incremental.failureCount === 0
          ? "completed"
          : "completed_with_failures",
      initialCreateIsCommonCost: true,
      limits: printableLimits(PROFILE_LIMITS[profile]),
      calls: branch.calls,
      summary: {
        incremental,
        includingInitialCreate: combineCallSummaries(
          sharedSummary,
          incremental,
        ),
        relativeToOldFullIncremental: relativeToOldFull(
          oldFullSummary,
          incremental,
        ),
        firstPreparedMs: firstPreparedMilliseconds(branch.calls, 250),
      },
    });
    await flushBufferedRecords();
  }
}

async function runProfileBranch({
  endpoint,
  rootDocument,
  profile,
  timeoutMs,
  sessionId,
}) {
  const limits = PROFILE_LIMITS[profile];
  let document = rootDocument;
  const calls = [];
  const initialSceneQueue = buildScenePrefetchQueue(
    document,
    document.rootId,
  );
  const selectedScenes = takeLimit(initialSceneQueue, limits.sceneCalls);

  for (const scene of selectedScenes) {
    const result = await requestLineage({
      endpoint,
      action: "expand",
      body: {
        action: "expand",
        document,
        nodeId: scene.nodeId,
        sessionId,
      },
      timeoutMs,
    });
    calls.push({ ...result.call, ordinal: calls.length + 1 });
    if (result.call.status === "success") {
      document = result.document;
    }
  }

  const root = document.nodes.find((node) => node.id === document.rootId);
  const includedNodeIds = root
    ? [root.id, ...root.childIds]
    : [document.rootId];
  const termBatches = buildTermPrefetchBatches(document, {
    includedNodeIds,
  });
  const selectedBatches = takeLimit(termBatches, limits.termBatches);

  for (const batch of selectedBatches) {
    const result = await requestLineage({
      endpoint,
      action: "define_batch",
      expectedTermCount: batch.items.length,
      body: {
        action: "define_batch",
        document,
        nodeId: batch.nodeId,
        terms: batch.items.map((item) => item.term),
        sessionId,
      },
      timeoutMs,
    });
    calls.push({ ...result.call, ordinal: calls.length + 1 });
  }

  return { calls };
}

async function requestLineage({
  endpoint,
  action,
  body,
  timeoutMs,
  expectedTermCount = 0,
}) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      call: failureCall({
        action,
        durationMs: performance.now() - startedAt,
        errorCode:
          error?.name === "TimeoutError" || error?.name === "AbortError"
            ? "request_timeout"
            : "network_error",
      }),
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      call: failureCall({
        action,
        durationMs: performance.now() - startedAt,
        httpStatus: response.status,
        errorCode: "invalid_json",
      }),
    };
  }

  if (!response.ok) {
    return {
      call: failureCall({
        action,
        durationMs: performance.now() - startedAt,
        httpStatus: response.status,
        errorCode: safeApiErrorCode(payload),
      }),
    };
  }

  let providerUsage;
  let validated;
  try {
    providerUsage = sanitizeUsageEvents(payload?.usage);
    validated = validatePayload(action, payload, expectedTermCount);
  } catch {
    return {
      call: failureCall({
        action,
        durationMs: performance.now() - startedAt,
        httpStatus: response.status,
        errorCode: "invalid_response_contract",
      }),
    };
  }

  return {
    call: {
      action,
      status: "success",
      durationMs: roundMilliseconds(performance.now() - startedAt),
      httpStatus: response.status,
      provider: safeMetadataLabel(payload.provider),
      model: safeMetadataLabel(payload.model),
      providerUsage,
    },
    ...validated,
  };
}

function validatePayload(action, payload, expectedTermCount) {
  if (action === "create" || action === "expand") {
    return { document: validateUsableDocument(payload?.document) };
  }
  if (action === "define_batch") {
    if (
      !Array.isArray(payload?.explanations) ||
      payload.explanations.length !== expectedTermCount ||
      !Array.isArray(payload?.contextTokens) ||
      payload.contextTokens.length !== expectedTermCount
    ) {
      throw new TypeError("incomplete define_batch payload");
    }
    payload.explanations.forEach((value) =>
      validateUsableTermExplanation(value),
    );
    if (
      !payload.contextTokens.every(
        (value) =>
          typeof value === "string" &&
          /^ect1\.[A-Za-z0-9_-]{43}$/u.test(value),
      )
    ) {
      throw new TypeError("invalid explanation context token");
    }
    return {};
  }
  throw new TypeError("unsupported action");
}

function validateUsableDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("document must be an object");
  }
  if (value.protocol !== "visual-explanation-document/2") {
    throw new TypeError("unsupported document protocol");
  }
  requiredNonEmptyString(value.id, "document.id");
  requiredNonEmptyString(value.question, "document.question");
  requiredNonEmptyString(value.rootId, "document.rootId");
  requiredNonEmptyString(value.title, "document.title");
  requiredNonEmptyString(value.thesis, "document.thesis");
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    throw new TypeError("document.version must be a positive integer");
  }
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length < 1 ||
    value.nodes.length > 80 ||
    !Array.isArray(value.relations)
  ) {
    throw new TypeError("document collections are invalid");
  }

  const nodesById = new Map();
  for (const [index, node] of value.nodes.entries()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new TypeError(`document.nodes[${index}] must be an object`);
    }
    const nodeId = requiredNonEmptyString(
      node.id,
      `document.nodes[${index}].id`,
    );
    if (nodesById.has(nodeId)) throw new TypeError("duplicate node id");
    requiredNonEmptyString(node.title, `document.nodes[${index}].title`);
    requiredNonEmptyString(node.summary, `document.nodes[${index}].summary`);
    requiredNonEmptyString(node.detail, `document.nodes[${index}].detail`);
    if (
      !Number.isSafeInteger(node.depth) ||
      node.depth < 0 ||
      node.depth > 12 ||
      !Array.isArray(node.childIds) ||
      !Array.isArray(node.terms) ||
      typeof node.expandable !== "boolean" ||
      typeof node.expansionState !== "string"
    ) {
      throw new TypeError(`document.nodes[${index}] has invalid fields`);
    }
    if (
      node.parentId !== null &&
      (typeof node.parentId !== "string" || !node.parentId.trim())
    ) {
      throw new TypeError(`document.nodes[${index}].parentId is invalid`);
    }
    if (
      !node.childIds.every(
        (childId) => typeof childId === "string" && childId.trim(),
      ) ||
      new Set(node.childIds).size !== node.childIds.length ||
      !node.terms.every(
        (term) => typeof term === "string" && term.trim(),
      )
    ) {
      throw new TypeError(`document.nodes[${index}] lists are invalid`);
    }
    nodesById.set(nodeId, node);
  }

  const root = nodesById.get(value.rootId);
  if (!root || root.parentId !== null || root.depth !== 0) {
    throw new TypeError("document root is invalid");
  }
  for (const node of value.nodes) {
    if (node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (
        !parent ||
        !parent.childIds.includes(node.id) ||
        node.depth !== parent.depth + 1
      ) {
        throw new TypeError("document parent/child topology is invalid");
      }
    }
    for (const childId of node.childIds) {
      const child = nodesById.get(childId);
      if (!child || child.parentId !== node.id) {
        throw new TypeError("document child reference is invalid");
      }
    }
  }
  return value;
}

function validateUsableTermExplanation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("term explanation must be an object");
  }
  if (value.protocol !== "visual-term-explanation/2") {
    throw new TypeError("unsupported term explanation protocol");
  }
  requiredNonEmptyString(value.term, "term explanation term");
  requiredNonEmptyString(value.nodeId, "term explanation nodeId");
  requiredNonEmptyString(value.definition, "term explanation definition");
  requiredNonEmptyString(value.relevance, "term explanation relevance");
  if (
    !Array.isArray(value.termPath) ||
    value.termPath.length < 1 ||
    !value.termPath.every(
      (term) => typeof term === "string" && term.trim(),
    ) ||
    !Array.isArray(value.terms) ||
    !value.terms.every(
      (term) => typeof term === "string" && term.trim(),
    )
  ) {
    throw new TypeError("term explanation lists are invalid");
  }
  return value;
}

function failureCall({
  action,
  durationMs,
  errorCode,
  httpStatus = null,
}) {
  return {
    action,
    status: "failure",
    durationMs: roundMilliseconds(durationMs),
    httpStatus,
    provider: "unknown",
    model: "unknown",
    providerUsage: [],
    errorCode,
  };
}

async function readJsonLines(datasetPath) {
  const source = await readFile(resolve(datasetPath), "utf8");
  const records = [];
  const ids = new Set();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new CliError("dataset_invalid_json");
    }
    const id = requiredCaseId(value?.id);
    if (ids.has(id)) throw new CliError("dataset_duplicate_case_id");
    ids.add(id);
    const question = requiredQuestion(value?.question);
    const repeatCount = optionalRepeatCount(value?.repeat_count);
    records.push({ id, question, repeatCount, lineNumber: index + 1 });
  }
  if (records.length === 0) throw new CliError("dataset_empty");
  return records;
}

function selectCases(allCases, requestedIds) {
  if (requestedIds.length === 0) return allCases;
  const wanted = new Set(requestedIds);
  const selected = allCases.filter((testCase) => wanted.has(testCase.id));
  if (selected.length !== wanted.size) {
    throw new CliError("unknown_case_id");
  }
  return selected;
}

function parseArguments(argv) {
  let datasetPath = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let outputPath = null;
  let help = false;
  const caseIds = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dataset") {
      datasetPath = requiredArgument(argv[++index], "dataset");
    } else if (argument === "--case") {
      caseIds.push(requiredCaseId(requiredArgument(argv[++index], "case")));
    } else if (argument === "--case-ids") {
      const values = requiredArgument(argv[++index], "case-ids")
        .split(",")
        .map((value) => requiredCaseId(value));
      caseIds.push(...values);
    } else if (argument === "--timeout-ms") {
      const value = Number(requiredArgument(argv[++index], "timeout-ms"));
      if (!Number.isSafeInteger(value) || value < 1_000 || value > 600_000) {
        throw new CliError("invalid_timeout");
      }
      timeoutMs = value;
    } else if (argument === "--output") {
      outputPath = requiredArgument(argv[++index], "output");
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else {
      throw new CliError("unknown_argument");
    }
  }

  if (!help && datasetPath === null) {
    throw new CliError("dataset_required");
  }
  return {
    datasetPath,
    caseIds: [...new Set(caseIds)],
    timeoutMs,
    outputPath,
    help,
  };
}

function lineageEndpoint(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new CliError("web_url_required");
  }
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new CliError("web_url_invalid");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CliError("web_url_invalid");
  }
  return new URL("/api/lineage", url);
}

function takeLimit(values, limit) {
  return Number.isFinite(limit) ? values.slice(0, limit) : values;
}

function printableLimits(limits) {
  return {
    sceneCalls: Number.isFinite(limits.sceneCalls)
      ? limits.sceneCalls
      : "all_direct",
    termBatches: Number.isFinite(limits.termBatches)
      ? limits.termBatches
      : "all_root_and_direct",
  };
}

function requiredArgument(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CliError(`${label}_required`);
  }
  return value.trim();
}

function requiredCaseId(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value.trim())
  ) {
    throw new CliError("invalid_case_id");
  }
  return value.trim();
}

function requiredQuestion(value) {
  if (typeof value !== "string") throw new CliError("invalid_question");
  const question = value.trim();
  if (!question || question.length > 1200) {
    throw new CliError("invalid_question");
  }
  return question;
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalRepeatCount(value) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new CliError("invalid_repeat_count");
  }
  return value;
}

function safeApiErrorCode(payload) {
  const value =
    payload?.error && typeof payload.error === "object"
      ? payload.error.code
      : payload?.error;
  return typeof value === "string" && /^[a-z0-9_-]{1,80}$/u.test(value)
    ? value
    : "http_error";
}

function safeMetadataLabel(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u.test(normalized)
    ? normalized
    : "unknown";
}

function createSessionId() {
  return `live_eval_${crypto.randomUUID().replaceAll("-", "")}`;
}

function roundMilliseconds(value) {
  return Math.round(value * 10) / 10;
}

function writeRecord(value) {
  if (recordOutputPath) {
    bufferedRecords.push(value);
    return;
  }
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function initializeRecordOutput(outputPath) {
  if (!outputPath) return;
  const resolvedPath = resolve(outputPath);
  try {
    const handle = await open(resolvedPath, "wx");
    await handle.close();
  } catch (error) {
    throw new CliError(
      error?.code === "EEXIST"
        ? "output_exists"
        : "output_create_failed",
    );
  }
  recordOutputPath = resolvedPath;
}

async function flushBufferedRecords() {
  if (!recordOutputPath || bufferedRecords.length === 0) return;
  const pending = bufferedRecords.slice();
  try {
    await appendFile(
      recordOutputPath,
      `${pending.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
  } catch {
    throw new CliError("output_append_failed");
  }
  bufferedRecords.splice(0, pending.length);
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  VISUALIZED_EXP_WEB_URL=http://localhost:3000 node --experimental-strip-types \\",
      "    evals/token-economy/live-compare.mjs --dataset <cases.jsonl> [--case-ids id1,id2] [--output result.jsonl]",
      "",
    ].join("\n"),
  );
}

function safeFatalCode(error) {
  return error instanceof CliError ? error.code : "unexpected_error";
}

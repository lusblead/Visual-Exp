import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (error) {
        if (
          error?.code === "ERR_MODULE_NOT_FOUND" &&
          /^\\.{1,2}\\//u.test(specifier) &&
          !/\\.[^/]+$/u.test(specifier)
        ) {
          return nextResolve(specifier + ".ts", context);
        }
        throw error;
      }
    }
  `)}`,
  import.meta.url,
);

const {
  EXPLANATION_CONTEXT_TOKEN_SECRET_ENV,
  fingerprintExplanationNodeContent,
  issueExplanationContextToken,
  verifyExplanationContextToken,
} = await import("../lib/explanation-context-token.ts");

const TEST_SECRET_A = "context-token-test-secret-a-000000000000";
const TEST_SECRET_B = "context-token-test-secret-b-111111111111";
const SENSITIVE_API_KEY = "sk-this-value-must-never-enter-the-token";

const node = {
  id: "node-rag",
  title: "Retrieval-augmented generation",
  eyebrow: "Grounding",
  summary: "RAG retrieves evidence before drafting an answer.",
  detail:
    "The retrieved evidence narrows what the model should claim in this passage.",
  terms: ["RAG", "retrieved evidence"],
};

const termExplanation = {
  protocol: "visual-term-explanation/2",
  term: "RAG",
  termPath: ["RAG"],
  nodeId: node.id,
  definition:
    "RAG retrieves evidence and supplies that retrieved evidence to a language model.",
  relevance:
    "In this passage, retrieved evidence constrains what the answer can claim.",
  terms: ["retrieved evidence"],
  confidence: "high",
  sourceStatus: "model_knowledge",
};

const deepExplanation = {
  protocol: "visual-deep-explanation/1",
  subject: "retrieved evidence",
  nodeId: node.id,
  directAnswer: "Retrieved evidence is material selected before generation.",
  background: "A model otherwise relies mainly on its trained parameters.",
  role: "Evidence gives the current answer a narrower knowledge boundary.",
  mechanism:
    "A retriever ranks candidate passages, then the selected passage enters the prompt.",
  boundary: "Retrieval does not prove that the selected passage is correct.",
  terms: ["retriever"],
  confidence: "high",
  sourceStatus: "model_knowledge",
};

function binding(explanation = termExplanation, overrides = {}) {
  return {
    documentId: "document-alpha",
    node,
    explanation,
    ...overrides,
  };
}

function withEnvironment(values, callback) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("term context token is compact, opaque, and valid only for its exact binding", () =>
  withEnvironment(
    {
      NODE_ENV: "test",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: TEST_SECRET_A,
      DEEPSEEK_API_KEY: SENSITIVE_API_KEY,
    },
    () => {
      const expectedBinding = binding();
      const token = issueExplanationContextToken(expectedBinding);

      assert.match(token, /^ect1\.[A-Za-z0-9_-]{43}$/u);
      assert.equal(token.length, 48);
      assert.equal(token.includes("RAG"), false);
      assert.equal(token.includes(SENSITIVE_API_KEY), false);
      assert.equal(
        verifyExplanationContextToken(token, expectedBinding),
        true,
      );

      assert.equal(
        fingerprintExplanationNodeContent(node),
        fingerprintExplanationNodeContent({ ...node }),
      );
      assert.notEqual(
        fingerprintExplanationNodeContent(node),
        fingerprintExplanationNodeContent({
          ...node,
          detail: `${node.detail} Changed.`,
        }),
      );
    },
  ));

test("tampering and cross-document or cross-node reuse fail closed", () =>
  withEnvironment(
    {
      NODE_ENV: "test",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: TEST_SECRET_A,
    },
    () => {
      const token = issueExplanationContextToken(binding());
      const cases = [
        binding(termExplanation, { documentId: "document-beta" }),
        binding(
          { ...termExplanation, nodeId: "node-other" },
          { node: { ...node, id: "node-other" } },
        ),
        binding(termExplanation, {
          node: { ...node, summary: `${node.summary} Tampered.` },
        }),
        binding({
          ...termExplanation,
          termPath: ["Knowledge", "RAG"],
        }),
        binding({
          ...termExplanation,
          protocol: "visual-term-explanation/1",
        }),
        binding({
          ...termExplanation,
          definition: `${termExplanation.definition} Tampered.`,
        }),
        binding({
          ...termExplanation,
          relevance: `${termExplanation.relevance} Tampered.`,
        }),
        binding({
          ...termExplanation,
          terms: ["language model"],
          definition: `${termExplanation.definition} The language model then answers.`,
        }),
      ];

      for (const alteredBinding of cases) {
        assert.equal(
          verifyExplanationContextToken(token, alteredBinding),
          false,
        );
      }

      assert.equal(verifyExplanationContextToken(`${token}x`, binding()), false);
      assert.equal(verifyExplanationContextToken("ect1.invalid", binding()), false);
      assert.equal(verifyExplanationContextToken(null, binding()), false);
    },
  ));

test("deep-result context is signed independently from short definitions", () =>
  withEnvironment(
    {
      NODE_ENV: "test",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: TEST_SECRET_A,
    },
    () => {
      const deepBinding = binding(deepExplanation);
      const token = issueExplanationContextToken(deepBinding);

      assert.equal(verifyExplanationContextToken(token, deepBinding), true);
      assert.equal(
        verifyExplanationContextToken(
          token,
          binding({
            ...deepExplanation,
            mechanism: `${deepExplanation.mechanism} Tampered.`,
          }),
        ),
        false,
      );
      assert.equal(
        verifyExplanationContextToken(token, binding(termExplanation)),
        false,
      );
    },
  ));

test("configured secrets rotate safely and development fallback is process-local", () => {
  const token = withEnvironment(
    {
      NODE_ENV: "test",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: TEST_SECRET_A,
    },
    () => issueExplanationContextToken(binding()),
  );

  withEnvironment(
    {
      NODE_ENV: "test",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: TEST_SECRET_B,
    },
    () => {
      assert.equal(verifyExplanationContextToken(token, binding()), false);
    },
  );

  withEnvironment(
    {
      NODE_ENV: "test",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: TEST_SECRET_A,
    },
    () => {
      assert.equal(verifyExplanationContextToken(token, binding()), true);
    },
  );

  withEnvironment(
    {
      NODE_ENV: "development",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: undefined,
    },
    () => {
      const first = issueExplanationContextToken(binding());
      const second = issueExplanationContextToken(binding());
      assert.equal(first, second);
      assert.equal(verifyExplanationContextToken(first, binding()), true);
    },
  );
});

test("production fails closed without a sufficiently strong server secret", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: undefined,
    },
    () => {
      assert.throws(
        () => issueExplanationContextToken(binding()),
        /生产环境必须配置 EXPLANATION_CONTEXT_TOKEN_SECRET/u,
      );
    },
  );

  withEnvironment(
    {
      NODE_ENV: "production",
      [EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]: "too-short",
    },
    () => {
      assert.throws(
        () => issueExplanationContextToken(binding()),
        /至少包含 32 字节/u,
      );
    },
  );
});

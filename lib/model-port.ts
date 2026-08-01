import { DeepSeekVisualModel } from "./deepseek-model";
import { companionTransport } from "./companion-client";
import { DemoVisualModel } from "./demo-model";
import type {
  DeepExplanationContext,
  DeepExplanationDraft,
} from "./deep-explanation";
import type { VisualDocument, VisualOperationBatch } from "./lineage-contracts";
import { OpenAIVisualModel } from "./openai-model";
import type {
  TermDefinitionContext,
  TermDefinitionDraft,
} from "./term-explanation";

export interface VisualModelContext {
  /** A random, privacy-preserving client identifier. Never use an email or user name. */
  safetyIdentifier?: string;
  /** Cancels provider work when the originating HTTP request is no longer needed. */
  signal?: AbortSignal;
  /** Receives bounded provider accounting metadata. Never include prompt or content. */
  onUsage?: (event: ModelUsageEvent) => void;
  /**
   * Server-fetched, bounded, untrusted search evidence. Models may cite only
   * these stable IDs; local assembly owns the resulting canonical URLs.
   */
  searchEvidence?: readonly VisualSearchEvidence[];
}

export interface VisualSearchEvidence {
  id: string;
  title: string;
  url: string;
  snippet: string | null;
  publishedAt: string | null;
}

export interface ProviderTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
}

export interface ModelUsageEvent {
  provider: "deepseek";
  model: string;
  phase: "primary" | "repair";
  providerAttempt: 1 | 2;
  usage: ProviderTokenUsage | null;
}

export interface VisualModelPort {
  create(question: string, context?: VisualModelContext): Promise<VisualDocument>;
  expand(
    document: VisualDocument,
    nodeId: string,
    context?: VisualModelContext,
  ): Promise<VisualOperationBatch>;
  defineTerm(
    input: TermDefinitionContext,
    context?: VisualModelContext,
  ): Promise<TermDefinitionDraft>;
  defineTerms(
    inputs: TermDefinitionContext[],
    context?: VisualModelContext,
  ): Promise<TermDefinitionDraft[]>;
  deepDive(
    input: DeepExplanationContext,
    context?: VisualModelContext,
  ): Promise<DeepExplanationDraft>;
}

export type VisualProvider = "deepseek" | "openai" | "demo";

export interface ResolvedVisualModel {
  provider: VisualProvider;
  modelName: string;
  termModelName: string;
  deepModelName: string;
  model: VisualModelPort;
  fallbackReason: string | null;
}

/**
 * Provider selection is isolated from the document protocol and UI. The new env
 * name is preferred, while LINEAGE_MODEL_PROVIDER remains a compatibility alias.
 */
export function resolveVisualModel(): ResolvedVisualModel {
  const configured = (
    process.env.EXPLANATION_MODEL_PROVIDER ??
    process.env.LINEAGE_MODEL_PROVIDER ??
    "deepseek"
  ).toLowerCase();

  if (configured === "deepseek") {
    const modelName = "deepseek-v4-pro";
    const companion = companionTransport();
    if (companion) {
      return {
        provider: "deepseek",
        modelName,
        termModelName: "deepseek-v4-flash",
        deepModelName: modelName,
        model: new DeepSeekVisualModel({
          apiKey: companion.bearerToken,
          baseUrl: companion.baseUrl,
        }),
        fallbackReason: null,
      };
    }
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      return {
        provider: "deepseek",
        modelName,
        termModelName: "deepseek-v4-flash",
        deepModelName: modelName,
        model: new DeepSeekVisualModel({
          apiKey,
          baseUrl: process.env.DEEPSEEK_BASE_URL,
        }),
        fallbackReason: null,
      };
    }
    return demoModel("未配置 DEEPSEEK_API_KEY，已使用确定性的离线演示");
  }

  if (configured === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    const modelName = process.env.OPENAI_MODEL ?? "gpt-5.6";
    if (apiKey) {
      return {
        provider: "openai",
        modelName,
        termModelName: modelName,
        deepModelName: modelName,
        model: new OpenAIVisualModel({ apiKey, model: modelName }),
        fallbackReason: null,
      };
    }
    return demoModel("选择了 OpenAI 但未配置 OPENAI_API_KEY，已使用确定性的离线演示");
  }

  return demoModel(configured === "demo" ? null : `未知模型提供方 ${configured}，已使用离线演示`);
}

function demoModel(reason: string | null): ResolvedVisualModel {
  return {
    provider: "demo",
    modelName: "deterministic-semantic-scenes/2",
    termModelName: "deterministic-semantic-scenes/2",
    deepModelName: "deterministic-semantic-scenes/2",
    model: new DemoVisualModel(),
    fallbackReason: reason,
  };
}

"use client";

import type {
  GenerationUsageReceipt,
  PregenerationProfile,
} from "../lib/knowledge-session-contract";
import type { KnowledgeSessionSummary } from "../lib/knowledge-session-repository";
import { summarizeProviderUsageReceipts } from "../lib/usage-receipt-metrics.mjs";

const PROFILE_OPTIONS: Array<{
  value: PregenerationProfile;
  label: string;
  description: string;
}> = [
  { value: "on_demand", label: "省流", description: "只在点击时生成" },
  { value: "balanced", label: "平衡", description: "预备少量下一步" },
  { value: "deep", label: "深入", description: "扩大当前层预备" },
];

export type KnowledgeSaveStatus =
  | "restoring"
  | "saving"
  | "saved"
  | "error"
  | "unavailable";

export function KnowledgeSessionControls({
  visible,
  activeSessionId,
  sessions,
  profile,
  receipts,
  saveStatus,
  onProfileChange,
  onSelectSession,
  onExport,
  onRetrySave,
}: {
  visible: boolean;
  activeSessionId: string | null;
  sessions: KnowledgeSessionSummary[];
  profile: PregenerationProfile;
  receipts: GenerationUsageReceipt[];
  saveStatus: KnowledgeSaveStatus;
  onProfileChange: (profile: PregenerationProfile) => void;
  onSelectSession: (sessionId: string) => void;
  onExport: (format: "json" | "markdown") => void;
  onRetrySave: () => void;
}) {
  if (!visible) return null;
  const hasActiveSession = activeSessionId !== null;
  const usageSummary = summarizeProviderUsageReceipts(receipts);
  const reportedTokens = usageSummary.fields.totalTokens.reportedTokens;
  const hasUnknownUsage =
    usageSummary.fields.totalTokens.unknownReceipts > 0;
  const seenReceiptIds = new Set<string>();
  const backgroundCalls = receipts.filter((receipt) => {
    if (seenReceiptIds.has(receipt.id)) return false;
    seenReceiptIds.add(receipt.id);
    return receipt.lane === "background";
  }).length;

  return (
    <details className="knowledge-session-controls">
      <summary aria-label="知识会话、预生成与导出" title="知识会话">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 5.5h10.5A3.5 3.5 0 0 1 19 9v9.5H8.5A3.5 3.5 0 0 1 5 15V5.5Z" />
          <path d="M8.5 18.5A3.5 3.5 0 0 1 5 15m4-5h6m-6 3h4" />
        </svg>
        <span
          className={`knowledge-save-dot is-${saveStatus}`}
          aria-hidden="true"
        />
      </summary>

      <div className="knowledge-session-panel">
        <section>
          <div className="knowledge-panel-heading">
            <h2>预生成</h2>
            <span>
              {hasActiveSession
                ? saveStatusLabel(saveStatus)
                : emptyWorkspaceStatusLabel(saveStatus)}
            </span>
          </div>
          <div className="prefetch-profile" role="radiogroup" aria-label="预生成强度">
            {PROFILE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={profile === option.value}
                className={profile === option.value ? "is-selected" : ""}
                onClick={() => onProfileChange(option.value)}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          {hasActiveSession ? (
            <p className="knowledge-usage">
              调用 {usageSummary.uniqueReceiptCount} 次 · 后台 {backgroundCalls} 次
              {reportedTokens > 0
                ? ` · ${reportedTokens.toLocaleString("zh-CN")} tokens`
                : hasUnknownUsage
                  ? " · token 数未知"
                  : ""}
            </p>
          ) : null}
          {hasActiveSession && saveStatus === "error" ? (
            <button
              type="button"
              className="knowledge-save-retry"
              onClick={onRetrySave}
            >
              重试保存
            </button>
          ) : null}
        </section>

        <section>
          <h2>知识记录</h2>
          {sessions.length > 0 ? (
            <div className="knowledge-session-list">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={session.id === activeSessionId ? "is-active" : ""}
                  aria-current={session.id === activeSessionId ? "page" : undefined}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span>{session.question}</span>
                  <time dateTime={session.updatedAt}>
                    {formatSessionTime(session.updatedAt)}
                  </time>
                </button>
              ))}
            </div>
          ) : (
            <p className="knowledge-session-empty">暂无记录</p>
          )}
        </section>

        {hasActiveSession ? (
          <section>
            <h2>导出</h2>
            <div className="knowledge-export-actions">
              <button type="button" onClick={() => onExport("markdown")}>
                Markdown
              </button>
              <button type="button" onClick={() => onExport("json")}>
                JSON
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}

function emptyWorkspaceStatusLabel(status: KnowledgeSaveStatus): string {
  if (status === "restoring") return "恢复中";
  if (status === "error") return "记录不可用";
  if (status === "unavailable") return "仅当前页面";
  return "就绪";
}

function saveStatusLabel(status: KnowledgeSaveStatus): string {
  switch (status) {
    case "restoring":
      return "恢复中";
    case "saving":
      return "保存中";
    case "saved":
      return "已保存";
    case "error":
      return "未保存";
    case "unavailable":
      return "仅当前页面";
  }
}

function formatSessionTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

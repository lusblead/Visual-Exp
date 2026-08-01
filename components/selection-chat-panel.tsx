"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  SelectionChatClientError,
  createSelectionChatTurn,
  listSelectionChatTurns,
  type SelectionChatContext,
  type SelectionChatSearchMode,
  type SelectionChatSearchStatus,
  type SelectionChatTurn,
} from "../lib/selection-chat-client";

export function SelectionChatPanel({
  sessionId,
  selection,
  open,
  onOpenChange,
  onClearSelection,
}: {
  sessionId: string;
  selection: SelectionChatContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClearSelection: () => void;
}) {
  const [turns, setTurns] = useState<SelectionChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [searchMode, setSearchMode] =
    useState<SelectionChatSearchMode>("auto");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [uncertainClientTurnId, setUncertainClientTurnId] = useState<
    string | null
  >(null);
  const uncertainClientTurnIdRef = useRef<string | null>(null);
  const historyEpoch = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const messageEnd = useRef<HTMLDivElement | null>(null);

  const refreshTurns = useCallback(async () => {
    const epoch = historyEpoch.current + 1;
    historyEpoch.current = epoch;
    historyAbort.current?.abort();
    const controller = new AbortController();
    historyAbort.current = controller;
    setHistoryLoading(true);
    setNotice(null);

    try {
      const nextTurns = await listSelectionChatTurns(sessionId, {
        signal: controller.signal,
      });
      if (historyEpoch.current !== epoch) return;
      setTurns(nextTurns);
      const uncertainId = uncertainClientTurnIdRef.current;
      uncertainClientTurnIdRef.current = null;
      setUncertainClientTurnId(null);
      if (
        uncertainId &&
        !nextTurns.some((turn) => turn.clientTurnId === uncertainId)
      ) {
        setNotice("服务端未记录上次请求，你可以再次发送。");
      }
    } catch (requestError) {
      if (isAbortError(requestError) || historyEpoch.current !== epoch) return;
      setNotice(readChatError(requestError, "暂时无法读取对话历史。"));
    } finally {
      if (historyEpoch.current === epoch) setHistoryLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void refreshTurns());
    return () => {
      window.cancelAnimationFrame(frame);
      historyEpoch.current += 1;
      const activeHistoryRequest = historyAbort.current;
      const activeSendRequest = sendAbort.current;
      historyAbort.current = null;
      sendAbort.current = null;
      activeHistoryRequest?.abort();
      activeSendRequest?.abort();
    };
  }, [refreshTurns]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const updateDesktop = () => setDesktop(media.matches);
    updateDesktop();
    media.addEventListener("change", updateDesktop);
    return () => media.removeEventListener("change", updateDesktop);
  }, []);

  const panelVisible = open;

  useEffect(() => {
    if (!panelVisible) return;
    const frame = window.requestAnimationFrame(() => {
      if (selection) composer.current?.focus();
      else closeButton.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panelVisible, selection]);

  useEffect(() => {
    let frame: number | null = null;
    if (open && !wasOpen.current) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    } else if (!open && wasOpen.current) {
      const target = previousFocus.current;
      frame = window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
        else launcher.current?.focus();
      });
    }
    wasOpen.current = open;
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab" || desktop || !panel.current) return;

      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel.current.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [desktop, onOpenChange, open]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function submitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.replace(/\s+/gu, " ").trim();
    if (!selection || !question || sending || uncertainClientTurnId) return;

    historyAbort.current?.abort();
    historyEpoch.current += 1;
    setHistoryLoading(false);
    const controller = new AbortController();
    sendAbort.current = controller;
    const clientTurnId = createClientTurnId();
    setSending(true);
    setNotice(null);

    try {
      const turn = await createSelectionChatTurn(
        {
          sessionId,
          clientTurnId,
          question,
          selection,
          searchMode,
        },
        { signal: controller.signal },
      );
      setTurns((current) => upsertTurn(current, turn));
      setDraft("");
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      uncertainClientTurnIdRef.current = clientTurnId;
      setUncertainClientTurnId(clientTurnId);
      setNotice(
        `${readChatError(
          requestError,
          "本次提交未能确认结果。",
        )} 请先刷新会话状态，避免重复发送。`,
      );
    } finally {
      if (sendAbort.current === controller) {
        sendAbort.current = null;
        setSending(false);
      }
    }
  }

  function handleComposerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const sendDisabled =
    !selection ||
    !draft.trim() ||
    sending ||
    uncertainClientTurnId !== null;

  return (
    <>
      <button
        type="button"
        className={`selection-chat-backdrop${open && !desktop ? " is-open" : ""}`}
        aria-label="关闭 AI 对话"
        onClick={() => onOpenChange(false)}
      />
      <aside
        ref={panel}
        className={`selection-chat-panel${panelVisible ? " is-open" : ""}`}
        role={!desktop ? "dialog" : undefined}
        aria-modal={!desktop && panelVisible ? true : undefined}
        aria-label="AI 对话"
        aria-hidden={!panelVisible ? true : undefined}
        tabIndex={-1}
      >
        <header className="selection-chat-header">
          <div>
            <span>AI 对话</span>
            <p>围绕选中的内容继续追问</p>
          </div>
          <div className="selection-chat-header-actions">
            <button
              type="button"
              onClick={() => void refreshTurns()}
              disabled={historyLoading || sending}
              aria-label="刷新 AI 对话历史"
              title="刷新历史"
            >
              ↻
            </button>
            <button
              ref={closeButton}
              type="button"
              className="selection-chat-close"
              onClick={() => onOpenChange(false)}
              aria-label="关闭 AI 对话"
            >
              ×
            </button>
          </div>
        </header>

        <div
          className="selection-chat-messages"
          role="log"
          aria-live="polite"
          aria-busy={historyLoading}
        >
          {historyLoading && turns.length === 0 ? (
            <p className="selection-chat-empty">正在读取历史会话…</p>
          ) : null}
          {!historyLoading && turns.length === 0 ? (
            <div className="selection-chat-empty">
              <span aria-hidden="true">“</span>
              <p>选中正文中的一句话，再点“向 AI 提问”。</p>
            </div>
          ) : null}
          {turns.map((turn) => (
            <SelectionChatTurnCard key={turn.id} turn={turn} />
          ))}
          <div ref={messageEnd} />
        </div>

        <form className="selection-chat-composer" onSubmit={submitTurn}>
          {selection ? (
            <blockquote className="selection-chat-context">
              <span>已引用</span>
              <p>{selection.text}</p>
              <button
                type="button"
                onClick={onClearSelection}
                aria-label="移除引用内容"
              >
                ×
              </button>
            </blockquote>
          ) : (
            <p className="selection-chat-context-empty">
              请先在正文中选择要提问的句子
            </p>
          )}
          {notice ? (
            <p className="selection-chat-notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="selection-chat-search-setting">
            <span>联网搜索</span>
            <div
              className="selection-chat-search-options"
              role="group"
              aria-label="选择本轮联网搜索方式"
              aria-describedby="selection-chat-search-help"
            >
              {SEARCH_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={searchMode === option.value ? "is-selected" : ""}
                  aria-pressed={searchMode === option.value}
                  onClick={() => setSearchMode(option.value)}
                  disabled={sending}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p id="selection-chat-search-help">
              {searchModeHelp(searchMode)}
            </p>
          </div>
          <div className="selection-chat-input-row">
            <textarea
              ref={composer}
              value={draft}
              rows={2}
              maxLength={4000}
              disabled={!selection || sending}
              placeholder={selection ? "输入你的问题…" : "选择一句话后开始提问"}
              aria-label="向 AI 提问"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="submit"
              disabled={sendDisabled}
              aria-label={sending ? "正在发送问题" : "发送问题"}
            >
              {sending ? "…" : "↑"}
            </button>
          </div>
          <p className="selection-chat-hint">
            Enter 发送 · Shift + Enter 换行
          </p>
        </form>
      </aside>
      <button
        ref={launcher}
        type="button"
        className={`selection-chat-launcher${panelVisible ? " is-hidden" : ""}`}
        onClick={() => onOpenChange(true)}
        aria-label="打开 AI 对话"
      >
        <span aria-hidden="true">AI</span>
        对话
      </button>
    </>
  );
}

function SelectionChatTurnCard({ turn }: { turn: SelectionChatTurn }) {
  return (
    <article className="selection-chat-turn">
      <div className="selection-chat-user">
        <span>你</span>
        <p>{turn.userText}</p>
      </div>
      <div className="selection-chat-assistant">
        <div className="selection-chat-assistant-meta">
          <span>AI</span>
          <time dateTime={turn.createdAt}>{formatTurnTime(turn.createdAt)}</time>
          <small
            className={`selection-chat-search-state is-${turn.search.status}`}
            title={searchStatusDescription(turn.search.status)}
          >
            {searchStatusLabel(turn.search.status, turn.search.callCount)}
          </small>
        </div>
        {turn.assistantText ? (
          <p>{turn.assistantText}</p>
        ) : (
          <p className={`is-${turn.status}`}>{statusMessage(turn.status)}</p>
        )}
        {turn.sources.length > 0 ? (
          <ol className="selection-chat-sources" aria-label="回答来源">
            {turn.sources.map((source, index) => {
              const href = safeSourceUrl(source.url);
              return (
                <li key={`${source.url}-${index}`}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  ) : (
                    <span>{source.title}</span>
                  )}
                  {source.snippet ? <p>{source.snippet}</p> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </article>
  );
}

function upsertTurn(
  turns: SelectionChatTurn[],
  nextTurn: SelectionChatTurn,
): SelectionChatTurn[] {
  const index = turns.findIndex(
    (turn) =>
      turn.id === nextTurn.id || turn.clientTurnId === nextTurn.clientTurnId,
  );
  if (index < 0) return [...turns, nextTurn];
  return turns.map((turn, turnIndex) =>
    turnIndex === index ? nextTurn : turn,
  );
}

function createClientTurnId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readChatError(error: unknown, fallback: string): string {
  if (error instanceof SelectionChatClientError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function statusMessage(status: SelectionChatTurn["status"]): string {
  switch (status) {
    case "pending":
      return "正在生成回答，稍后刷新可查看结果。";
    case "failed":
      return "这次回答失败了，请调整问题后重新发送。";
    case "unknown":
      return "结果状态待确认，请先刷新会话历史。";
    case "completed":
      return "回答已完成，但服务端没有返回正文。";
  }
}

const SEARCH_MODE_OPTIONS: readonly {
  value: SelectionChatSearchMode;
  label: string;
}[] = [
  { value: "off", label: "关闭" },
  { value: "auto", label: "自动" },
  { value: "force", label: "强制" },
] as const;

function searchModeHelp(mode: SelectionChatSearchMode): string {
  switch (mode) {
    case "off":
      return "本轮不会使用联网搜索。";
    case "auto":
      return "由 AI 判断本轮是否需要搜索。";
    case "force":
      return "本轮必须先完成搜索再回答。";
  }
}

function searchStatusLabel(
  status: SelectionChatSearchStatus,
  callCount: number,
): string {
  switch (status) {
    case "disabled":
      return "未联网";
    case "unavailable":
      return "联网不可用";
    case "offered":
      return "允许联网";
    case "used":
      return callCount > 0 ? `已联网 · ${callCount} 次` : "已联网";
    case "failed":
      return "联网失败";
    case "legacy_unknown":
      return "联网状态未知";
  }
}

function searchStatusDescription(status: SelectionChatSearchStatus): string {
  switch (status) {
    case "disabled":
      return "这轮回答按你的设置关闭了联网搜索。";
    case "unavailable":
      return "这轮回答没有可用的搜索供应商。";
    case "offered":
      return "这轮允许联网，但没有记录到完成的搜索调用。";
    case "used":
      return "这轮回答实际执行了联网搜索。";
    case "failed":
      return "这轮要求或尝试的联网搜索没有完成。";
    case "legacy_unknown":
      return "旧回合没有记录可核验的联网执行状态。";
  }
}

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatTurnTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

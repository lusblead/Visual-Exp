import type { FormEvent } from "react";

export function QuestionComposer({
  question,
  started,
  busy,
  modelConfigured,
  modelStatusBusy,
  onQuestionChange,
  onCreate,
  onOpenModelSettings,
}: {
  question: string;
  started: boolean;
  busy: boolean;
  modelConfigured: boolean;
  modelStatusBusy: boolean;
  onQuestionChange: (value: string) => void;
  onCreate: () => void;
  onOpenModelSettings: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate();
  }

  return (
    <header className={`question-shell ${started ? "is-docked" : "is-centered"}`}>
      <form className="question-composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="visual-question">
          请输入你的问题
        </label>
        <input
          id="visual-question"
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          maxLength={1200}
          placeholder="请输入你的问题"
          autoComplete="off"
          autoFocus
        />
        <button
          type="button"
          className="question-settings"
          onClick={onOpenModelSettings}
          aria-label="模型与 API Key 设置"
          title="DeepSeek V4 Pro"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" />
          </svg>
          <span
            className={`question-model-dot ${modelConfigured ? "is-configured" : ""} ${
              modelStatusBusy ? "is-loading" : ""
            }`}
            aria-hidden="true"
          />
        </button>
        <button
          type="submit"
          className="question-submit"
          disabled={busy || !question.trim()}
          aria-label={busy ? "正在生成视觉解释" : "生成视觉解释"}
        >
          <span aria-hidden="true">{busy ? "·" : "↑"}</span>
        </button>
      </form>
    </header>
  );
}

export function HistoryControls({
  visible,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  visible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  if (!visible) return null;
  return (
    <nav className="history-controls" aria-label="探索历史">
      <button type="button" onClick={onBack} disabled={!canGoBack} aria-label="返回上一个场景">
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="前往下一个场景"
      >
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}

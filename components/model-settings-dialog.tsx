"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { ProviderSettingsPanel } from "@/components/provider-settings-panel";

export interface ModelSettingsStatus {
  configured: boolean;
  provider: "deepseek";
  model: "deepseek-v4-pro";
  source: "local_vault" | "environment" | "none";
  persistentAvailable: boolean;
  companionAvailable: boolean;
}

export function ModelSettingsDialog({
  open,
  status,
  busy,
  error,
  searchEnabled,
  onClose,
  onSave,
  onDelete,
  onSearchEnabledChange,
}: {
  open: boolean;
  status: ModelSettingsStatus | null;
  busy: boolean;
  error: string | null;
  searchEnabled: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onSearchEnabledChange: (enabled: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleClose() {
    setApiKey("");
    setVisible(false);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim() || busy) return;
    const saved = await onSave(apiKey);
    if (saved) {
      setApiKey("");
      setVisible(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="model-settings-dialog"
      aria-labelledby="model-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      onClose={handleClose}
    >
      <button
        type="button"
        className="settings-close"
        onClick={handleClose}
        aria-label="关闭模型设置"
      >
        <span aria-hidden="true">×</span>
      </button>

      <div className="model-identity">
        <span
          className={`model-state-dot ${status?.configured ? "is-configured" : ""}`}
          aria-hidden="true"
        />
        <div>
          <p>本机 DeepSeek · 默认通道</p>
          <h2 id="model-settings-title">AI 服务</h2>
          <code>深入解释 + AI 对话默认模型</code>
        </div>
      </div>

      <p className="settings-model-scope">
        本机 DeepSeek 同时是深入解释和 AI 对话默认模型。只有设置下方的模型覆盖后，
        AI 对话才会改用其他模型。
      </p>

      <p className="settings-explanation">
        {status?.source === "local_vault"
          ? "API Key 已安全保存在这台 Windows 电脑，刷新或重启后仍可使用。"
          : status?.source === "environment"
            ? "当前由本地服务环境变量提供 API Key。你也可以保存一个本机凭据来替换它。"
            : status?.persistentAvailable
              ? "输入一次 API Key，验证成功后会保存到 Windows 凭据管理器。"
              : "请使用本地模式启动应用，才能把 API Key 安全保存到这台电脑。"}
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="deepseek-api-key">本机 DeepSeek API Key</label>
        <div className="credential-input">
          <input
            ref={inputRef}
            id="deepseek-api-key"
            type={visible ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={status?.configured ? "输入新 Key 以替换" : "sk-…"}
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy || !status?.persistentAvailable || !status.companionAvailable}
          />
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
            aria-pressed={visible}
            disabled={!apiKey}
          >
            <span aria-hidden="true">{visible ? "隐藏" : "显示"}</span>
          </button>
        </div>

        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="settings-actions">
          {status?.source === "local_vault" ? (
            <button
              type="button"
              className="credential-delete"
              onClick={() => void onDelete()}
              disabled={busy}
            >
              删除本地 Key
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="credential-save"
            disabled={
              busy ||
              !apiKey.trim() ||
              !status?.persistentAvailable ||
              !status.companionAvailable
            }
          >
            {busy ? "正在验证…" : "保存到本机"}
          </button>
        </div>
      </form>

      {open ? (
        <ProviderSettingsPanel
          defaultChatAvailable={Boolean(
            status?.configured && status.companionAvailable,
          )}
          searchEnabled={searchEnabled}
          onSearchEnabledChange={onSearchEnabledChange}
        />
      ) : null}
    </dialog>
  );
}

"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  API_FORMAT_OPTIONS,
  AUTH_TYPE_OPTIONS,
  ENDPOINT_MODE_OPTIONS,
  ProviderSettingsError,
  activateProvider,
  createProvider,
  defaultAuthHeader,
  deleteProvider,
  draftForProvider,
  emptyProviderDraft,
  listProviders,
  presetForProvider,
  presetsForKind,
  updateProvider,
  type ApiFormat,
  type AuthType,
  type EndpointMode,
  type ProviderId,
  type ProviderKind,
  type ProviderSummary,
  type ProviderWriteDraft,
} from "@/lib/provider-settings";

export function ProviderSettingsPanel({
  defaultChatAvailable,
  searchEnabled,
  onSearchEnabledChange,
}: {
  defaultChatAvailable: boolean;
  searchEnabled: boolean;
  onSearchEnabledChange: (enabled: boolean) => void;
}) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [draft, setDraft] = useState<ProviderWriteDraft>(() =>
    emptyProviderDraft(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const kindPresets = useMemo(
    () => presetsForKind(draft.kind),
    [draft.kind],
  );
  const selectedPreset = presetForProvider(draft.provider);
  const visibleProviders = providers.filter(
    (provider) => provider.kind === draft.kind,
  );
  const modelSuggestions = selectedPreset?.modelSuggestions ?? [];
  const activeSearchProvider = providers.find(
    (provider) => provider.kind === "search" && provider.active,
  );

  useEffect(() => {
    const controller = new AbortController();
    void listProviders({ signal: controller.signal })
      .then((items) => {
        setProviders(sortProviders(items));
      })
      .catch((cause: unknown) => {
        if (!isAbort(cause)) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!loading && searchEnabled && !activeSearchProvider) {
      onSearchEnabledChange(false);
    }
  }, [activeSearchProvider, loading, onSearchEnabledChange, searchEnabled]);

  function switchKind(kind: ProviderKind) {
    if (action || kind === draft.kind) return;
    setDraft(emptyProviderDraft(kind));
    resetEditorState();
  }

  function selectProvider(provider: ProviderId) {
    const preset = presetForProvider(provider);
    if (!preset || preset.kind !== draft.kind) return;
    setDraft(draftForProvider(provider));
    resetEditorState();
  }

  function editProvider(provider: ProviderSummary) {
    setDraft({
      name: provider.name,
      kind: provider.kind,
      provider: provider.provider,
      apiKey: "",
      baseUrl: provider.baseUrl ?? "",
      defaultModel: provider.defaultModel ?? "",
      apiFormat: provider.apiFormat,
      endpointMode: provider.endpointMode,
      authType: provider.authType,
      authHeader: provider.authHeader ?? "",
      activate: provider.active,
    });
    setEditingId(provider.id);
    setError(null);
    setNotice(null);
    setKeyVisible(false);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    setDraft(emptyProviderDraft(draft.kind));
    resetEditorState();
  }

  function resetEditorState() {
    setEditingId(null);
    setError(null);
    setNotice(null);
    setKeyVisible(false);
    setConfirmDeleteId(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action) return;
    setAction("save");
    setError(null);
    setNotice(null);
    try {
      const saved = editingId
        ? await updateProvider(editingId, draft)
        : await createProvider(draft);
      setProviders((current) => mergeProvider(current, saved));
      setNotice(
        `${saved.name} 已验证并${editingId ? "更新" : "保存"}${
          saved.active ? `，已设为${activeRoleLabel(saved.kind)}` : ""
        }。`,
      );
      setDraft(emptyProviderDraft(saved.kind));
      setEditingId(null);
      setKeyVisible(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDraft((current) => ({ ...current, apiKey: "" }));
      setAction(null);
    }
  }

  async function handleActivate(provider: ProviderSummary) {
    if (action || provider.active) return;
    setAction(`activate:${provider.id}`);
    setError(null);
    setNotice(null);
    try {
      const activated = await activateProvider(provider.id);
      setProviders((current) => mergeProvider(current, activated));
      setNotice(`${activated.name} 已设为${activeRoleLabel(activated.kind)}。`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setAction(null);
    }
  }

  async function handleDelete(provider: ProviderSummary) {
    if (action) return;
    if (confirmDeleteId !== provider.id) {
      setConfirmDeleteId(provider.id);
      setNotice(null);
      return;
    }
    setAction(`delete:${provider.id}`);
    setError(null);
    setNotice(null);
    try {
      await deleteProvider(provider.id);
      setProviders((current) =>
        current.filter((item) => item.id !== provider.id),
      );
      if (editingId === provider.id) {
        setDraft(emptyProviderDraft(provider.kind));
        setEditingId(null);
        setKeyVisible(false);
      }
      setNotice(`${provider.name} 已删除。`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setConfirmDeleteId(null);
      setAction(null);
    }
  }

  function changeAuthType(authType: AuthType) {
    setDraft((current) => ({
      ...current,
      authType,
      authHeader: defaultAuthHeader(authType),
    }));
  }

  return (
    <section
      className="provider-settings"
      aria-labelledby="provider-settings-title"
    >
      <div className="provider-settings-heading">
        <div>
          <p className="provider-settings-kicker">可选覆盖与搜索</p>
          <h3 id="provider-settings-title">覆盖 AI 对话模型，或选择搜索服务</h3>
          <p>
            {defaultChatAvailable
              ? "不配置模型覆盖时，AI 对话沿用上方已配置的本机 DeepSeek；"
              : "上方本机 DeepSeek 当前不可用于 AI 对话，请先配置它或添加模型覆盖；"}
            搜索服务与主问题联网许可在同一区域管理；AI 对话仍按每轮选择。
          </p>
        </div>
        <div className="provider-settings-counts" aria-label="配置概况">
          <span>
            <strong>
              {providers.filter((provider) => provider.kind === "model").length}
            </strong>
            覆盖
          </span>
          <span>
            <strong>
              {providers.filter((provider) => provider.kind === "search").length}
            </strong>
            搜索
          </span>
        </div>
      </div>

      <div className="provider-kind-tabs" aria-label="配置类型">
        <button
          type="button"
          className={draft.kind === "model" ? "is-selected" : ""}
          aria-pressed={draft.kind === "model"}
          onClick={() => switchKind("model")}
          disabled={Boolean(action)}
        >
          模型覆盖（可选）
        </button>
        <button
          type="button"
          className={draft.kind === "search" ? "is-selected" : ""}
          aria-pressed={draft.kind === "search"}
          onClick={() => switchKind("search")}
          disabled={Boolean(action)}
        >
          搜索服务
        </button>
      </div>

      {draft.kind === "search" ? (
        <section
          className={`provider-search-permission${searchEnabled ? " is-on" : ""}`}
          aria-labelledby="provider-search-permission-title"
        >
          <div>
            <span>主问题权限</span>
            <h4 id="provider-search-permission-title">允许下一次主问题联网</h4>
            <p>
              {activeSearchProvider
                ? `当前通过 ${activeSearchProvider.name} 搜索。启用供应商不会自动打开联网。`
                : "先验证并设为当前搜索服务；未配置搜索的用户始终走纯模型路径。"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={searchEnabled}
            aria-label={searchEnabled ? "关闭主问题联网搜索" : "开启主问题联网搜索"}
            className="provider-search-switch"
            onClick={() => onSearchEnabledChange(!searchEnabled)}
            disabled={Boolean(action) || loading || !activeSearchProvider}
          >
            <span aria-hidden="true" />
            {activeSearchProvider
              ? searchEnabled
                ? "已开启"
                : "保持关闭"
              : "未配置"}
          </button>
        </section>
      ) : null}

      <div className="provider-settings-grid">
        <section
          className="provider-profile-section"
          aria-labelledby="provider-profile-title"
        >
          <div className="provider-section-title">
            <div>
              <h4 id="provider-profile-title">
                {draft.kind === "model" ? "已配置的模型覆盖" : "已配置的搜索服务"}
              </h4>
              <p>
                {draft.kind === "model"
                  ? defaultChatAvailable
                    ? "当前覆盖会用于新的 AI 对话；没有覆盖时使用已配置的本机 DeepSeek。"
                    : "当前没有可用的默认对话模型；请配置上方本机 DeepSeek，或添加并启用一个覆盖。"
                  : "当前搜索服务只决定请求线路，不代表已经开启联网。"}
              </p>
            </div>
            {loading ? (
              <span className="provider-loading" role="status">
                正在读取…
              </span>
            ) : null}
          </div>

          {!loading && visibleProviders.length === 0 ? (
            <div className="provider-empty">
              <span aria-hidden="true">＋</span>
              <p>还没有{kindLabel(draft.kind)}配置</p>
              <small>选择一个预设并验证 API Key。</small>
            </div>
          ) : (
            <ul className="provider-profile-list">
              {visibleProviders.map((provider) => {
                const preset = presetForProvider(provider.provider);
                const deleting = action === `delete:${provider.id}`;
                return (
                  <li
                    key={provider.id}
                    className={provider.active ? "is-active" : ""}
                  >
                    <div className="provider-profile-main">
                      <span
                        className="provider-profile-rail"
                        aria-hidden="true"
                      />
                      <div>
                        <div className="provider-profile-name">
                          <strong>{provider.name}</strong>
                          <span
                            className={`provider-state ${
                              provider.active ? "is-active" : ""
                            }`}
                          >
                            {provider.active
                              ? activeRoleLabel(provider.kind)
                              : "已配置"}
                          </span>
                        </div>
                        <p>
                          {preset?.label ?? provider.provider}
                          {provider.defaultModel
                            ? ` · ${provider.defaultModel}`
                            : ""}
                        </p>
                        {provider.kind === "model" ? (
                          <small>{modelProtocolSummary(provider)}</small>
                        ) : null}
                        <small title={provider.baseUrl ?? undefined}>
                          {provider.baseUrl ?? "地址由服务端管理"}
                        </small>
                        <small>
                          验证于 {formatVerifiedAt(provider.lastVerifiedAt)}
                        </small>
                      </div>
                    </div>
                    <div className="provider-profile-actions">
                      <button
                        type="button"
                        onClick={() => editProvider(provider)}
                        disabled={Boolean(action)}
                      >
                        编辑
                      </button>
                      {!provider.active ? (
                        <button
                          type="button"
                          onClick={() => void handleActivate(provider)}
                          disabled={Boolean(action)}
                        >
                          {action === `activate:${provider.id}`
                            ? "设置中…"
                            : provider.kind === "model"
                              ? "设为覆盖"
                              : "设为当前"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={
                          confirmDeleteId === provider.id
                            ? "is-confirming"
                            : ""
                        }
                        onClick={() => void handleDelete(provider)}
                        disabled={Boolean(action)}
                      >
                        {deleting
                          ? "删除中…"
                          : confirmDeleteId === provider.id
                            ? "确认删除"
                            : "删除"}
                      </button>
                      {confirmDeleteId === provider.id && !action ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          取消
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <form className="provider-editor" onSubmit={handleSave}>
          <div className="provider-section-title">
            <div>
              <h4>{editingId ? "更新配置" : `添加${kindLabel(draft.kind)}`}</h4>
              <p>
                {editingId
                  ? "API Key 留空会沿用已验证的原密钥。"
                  : "密钥仅在保存时发送，之后不会回显。"}
              </p>
            </div>
            {editingId ? (
              <button type="button" onClick={cancelEdit} disabled={Boolean(action)}>
                取消编辑
              </button>
            ) : null}
          </div>

          <fieldset className="provider-preset-fieldset">
            <legend>供应商预设</legend>
            <div className="provider-preset-picker">
              {kindPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={draft.provider === preset.id ? "is-selected" : ""}
                  aria-pressed={draft.provider === preset.id}
                  onClick={() => selectProvider(preset.id)}
                  disabled={Boolean(action)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <small>{selectedPreset?.description}</small>
          </fieldset>

          <div className="provider-form-row">
            <label>
              <span>配置名称</span>
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                maxLength={80}
                autoComplete="off"
                disabled={Boolean(action)}
              />
            </label>

            {draft.kind === "model" ? (
              <label>
                <span>模型标识</span>
                <input
                  value={draft.defaultModel}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultModel: event.target.value,
                    }))
                  }
                  placeholder="输入账户可用的模型 ID"
                  list="provider-model-suggestions"
                  maxLength={160}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={Boolean(action)}
                />
                <datalist id="provider-model-suggestions">
                  {modelSuggestions.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
            ) : null}
          </div>

          {draft.kind === "model" ? (
            <>
              <label>
                <span>
                  {draft.endpointMode === "full_url"
                    ? "完整请求 URL"
                    : "API 根地址"}
                </span>
                <input
                  type="url"
                  value={draft.baseUrl}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder={
                    draft.endpointMode === "full_url"
                      ? "https://api.example.com/v1/chat/completions"
                      : "https://api.example.com/v1"
                  }
                  maxLength={500}
                  autoComplete="url"
                  spellCheck={false}
                  disabled={Boolean(action)}
                />
                <small>
                  {draft.endpointMode === "full_url"
                    ? "填写最终聊天请求地址，系统不会再拼接协议路径。"
                    : "系统会按下方 API 格式拼接聊天路径。仅允许 HTTPS 地址。"}
                </small>
              </label>

              <details className="provider-advanced">
                <summary>
                  <span>高级协议</span>
                  <small>{advancedSummary(draft)}</small>
                </summary>
                <div className="provider-advanced-body">
                  <div className="provider-form-row">
                    <label>
                      <span>API 格式</span>
                      <select
                        value={draft.apiFormat ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            apiFormat: event.target.value as ApiFormat,
                          }))
                        }
                        disabled={Boolean(action)}
                      >
                        {API_FORMAT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>地址模式</span>
                      <select
                        value={draft.endpointMode ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            endpointMode: event.target.value as EndpointMode,
                          }))
                        }
                        disabled={Boolean(action)}
                      >
                        {ENDPOINT_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label>
                    <span>认证方式</span>
                    <select
                      value={draft.authType ?? ""}
                      onChange={(event) =>
                        changeAuthType(event.target.value as AuthType)
                      }
                      disabled={Boolean(action)}
                    >
                      {AUTH_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {draft.authType !== "custom_header" ? (
                    <p className="provider-auth-preview">
                      Key 会写入 <code>{authWirePreview(draft.authType)}</code>
                    </p>
                  ) : (
                    <label>
                      <span>认证 Header</span>
                      <input
                        value={draft.authHeader}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            authHeader: event.target.value,
                          }))
                        }
                        placeholder="X-API-Key"
                        maxLength={80}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={Boolean(action)}
                      />
                      <small>
                        只配置 Key 所在 Header；不支持任意 Header 或请求体覆盖。
                      </small>
                    </label>
                  )}
                </div>
              </details>
            </>
          ) : (
            <p className="provider-search-explanation">
              {draft.provider === "tavily" ? "Tavily" : "Brave Search"} Key
              只用于搜索服务鉴权，不会替代模型 API Key。请求地址由服务端维护。
              主问题联网许可在本页搜索服务区域开启；AI 对话仍按每轮选择。
            </p>
          )}

          <label>
            <span>
              API Key
              {editingId ? <em>可留空</em> : null}
            </span>
            <div className="provider-key-input">
              <input
                type={keyVisible ? "text" : "password"}
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={editingId ? "留空沿用原 Key" : "仅写入，不回显"}
                autoComplete="new-password"
                spellCheck={false}
                disabled={Boolean(action)}
              />
              <button
                type="button"
                onClick={() => setKeyVisible((current) => !current)}
                aria-label={keyVisible ? "隐藏 API Key" : "显示 API Key"}
                aria-pressed={keyVisible}
                disabled={!draft.apiKey || Boolean(action)}
              >
                {keyVisible ? "隐藏" : "显示"}
              </button>
            </div>
          </label>

          <label className="provider-activate-choice">
            <input
              type="checkbox"
              checked={draft.activate}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  activate: event.target.checked,
                }))
              }
              disabled={Boolean(action)}
            />
            <span>
              {draft.kind === "model"
                ? "验证成功后设为当前模型覆盖"
                : "验证成功后设为当前搜索服务"}
            </span>
          </label>

          {draft.kind === "search" ? (
            <p className="provider-verification-note">
              保存搜索服务会发起一次最小验证查询，可能计入供应商 API 用量。
            </p>
          ) : (
            <p className="provider-model-verification">
              保存会使用所选模型 ID 发起一次最小对话验证，可能计入模型用量。
            </p>
          )}

          <button
            type="submit"
            className="provider-save"
            disabled={Boolean(action)}
          >
            {action === "save"
              ? "正在验证供应商…"
              : editingId
                ? "验证并更新"
                : "验证并保存"}
          </button>
        </form>
      </div>

      {error ? (
        <p className="provider-feedback is-error" role="alert">
          {error}
        </p>
      ) : notice ? (
        <p className="provider-feedback" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function mergeProvider(
  current: ProviderSummary[],
  incoming: ProviderSummary,
): ProviderSummary[] {
  const next = current.map((provider) =>
    incoming.active &&
    provider.kind === incoming.kind &&
    provider.id !== incoming.id
      ? { ...provider, active: false }
      : provider,
  );
  const index = next.findIndex((provider) => provider.id === incoming.id);
  if (index === -1) return sortProviders([...next, incoming]);
  next[index] = incoming;
  return sortProviders(next);
}

function sortProviders(providers: ProviderSummary[]): ProviderSummary[] {
  return [...providers].sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
}

function kindLabel(kind: ProviderKind): string {
  return kind === "model" ? "模型覆盖" : "搜索服务";
}

function activeRoleLabel(kind: ProviderKind): string {
  return kind === "model" ? "当前模型覆盖" : "当前搜索服务";
}

function apiFormatLabel(value: ApiFormat | null): string {
  return (
    API_FORMAT_OPTIONS.find((option) => option.value === value)?.label ??
    "未选择协议"
  );
}

function endpointModeLabel(value: EndpointMode | null): string {
  return (
    ENDPOINT_MODE_OPTIONS.find((option) => option.value === value)?.label ??
    "未选择地址模式"
  );
}

function authTypeLabel(value: AuthType | null): string {
  return (
    AUTH_TYPE_OPTIONS.find((option) => option.value === value)?.label ??
    "未选择认证"
  );
}

function authWirePreview(value: AuthType | null): string {
  if (value === "bearer") return "Authorization: Bearer …";
  if (value === "x_api_key") return "x-api-key: …";
  if (value === "api_key") return "api-key: …";
  return "自定义 Header";
}

function advancedSummary(draft: ProviderWriteDraft): string {
  return `${apiFormatLabel(draft.apiFormat)} · ${authTypeLabel(draft.authType)}`;
}

function modelProtocolSummary(provider: ProviderSummary): string {
  return `${apiFormatLabel(provider.apiFormat)} · ${endpointModeLabel(
    provider.endpointMode,
  )} · ${authTypeLabel(provider.authType)}`;
}

function formatVerifiedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近一次保存";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ProviderSettingsError) {
    return cause.requestId
      ? `${cause.message}（请求编号 ${cause.requestId}）`
      : cause.message;
  }
  return "配置操作没有完成，请稍后重试。";
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

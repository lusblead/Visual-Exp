package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;

import java.util.Locale;

public enum ProviderType {
    OPENAI(
        "openai",
        ProviderKind.MODEL,
        "https://api.openai.com/v1",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    ANTHROPIC(
        "anthropic",
        ProviderKind.MODEL,
        "https://api.anthropic.com",
        ApiFormat.ANTHROPIC_MESSAGES,
        AuthType.X_API_KEY,
        null
    ),
    DEEPSEEK(
        "deepseek",
        ProviderKind.MODEL,
        "https://api.deepseek.com",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    KIMI(
        "kimi",
        ProviderKind.MODEL,
        "https://api.moonshot.cn/v1",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    GLM(
        "glm",
        ProviderKind.MODEL,
        "https://open.bigmodel.cn/api/paas/v4",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    GEMINI(
        "gemini",
        ProviderKind.MODEL,
        "https://generativelanguage.googleapis.com/v1beta/openai",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    QWEN(
        "qwen",
        ProviderKind.MODEL,
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    OPENROUTER(
        "openrouter",
        ProviderKind.MODEL,
        "https://openrouter.ai/api/v1",
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    CUSTOM_OPENAI_COMPATIBLE(
        "custom_openai_compatible",
        ProviderKind.MODEL,
        null,
        ApiFormat.OPENAI_CHAT_COMPLETIONS,
        AuthType.BEARER,
        null
    ),
    TAVILY(
        "tavily",
        ProviderKind.SEARCH,
        "https://api.tavily.com",
        null,
        AuthType.BEARER,
        null
    ),
    BRAVE(
        "brave",
        ProviderKind.SEARCH,
        "https://api.search.brave.com",
        null,
        AuthType.CUSTOM_HEADER,
        "X-Subscription-Token"
    ),
    ;

    private final String wireName;
    private final ProviderKind kind;
    private final String defaultBaseUrl;
    private final ApiFormat defaultApiFormat;
    private final AuthType defaultAuthType;
    private final String defaultAuthHeader;

    ProviderType(
        String wireName,
        ProviderKind kind,
        String defaultBaseUrl,
        ApiFormat defaultApiFormat,
        AuthType defaultAuthType,
        String defaultAuthHeader
    ) {
        this.wireName = wireName;
        this.kind = kind;
        this.defaultBaseUrl = defaultBaseUrl;
        this.defaultApiFormat = defaultApiFormat;
        this.defaultAuthType = defaultAuthType;
        this.defaultAuthHeader = defaultAuthHeader;
    }

    public String wireName() {
        return wireName;
    }

    public ProviderKind kind() {
        return kind;
    }

    public String defaultBaseUrl() {
        return defaultBaseUrl;
    }

    public ApiFormat defaultApiFormat() {
        return defaultApiFormat;
    }

    public AuthType defaultAuthType() {
        return defaultAuthType;
    }

    public String defaultAuthHeader() {
        return defaultAuthHeader;
    }

    public boolean addressIsFixed() {
        return kind == ProviderKind.SEARCH;
    }

    public static ProviderType parse(String value) {
        if (value != null) {
            String normalized = value.toLowerCase(Locale.ROOT);
            for (ProviderType type : values()) {
                if (type.wireName.equals(normalized)) {
                    return type;
                }
            }
        }
        throw new ApiException("validation_error", "provider 不受支持。", 400, false);
    }
}

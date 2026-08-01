package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;

import java.util.Locale;

public enum ApiFormat {
    OPENAI_CHAT_COMPLETIONS("openai_chat_completions"),
    ANTHROPIC_MESSAGES("anthropic_messages");

    private final String wireName;

    ApiFormat(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static ApiFormat parse(String value) {
        if (value != null) {
            String normalized = value.toLowerCase(Locale.ROOT);
            for (ApiFormat format : values()) {
                if (format.wireName.equals(normalized)) {
                    return format;
                }
            }
        }
        throw new ApiException("validation_error", "apiFormat 不受支持。", 400, false);
    }
}

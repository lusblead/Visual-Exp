package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;

import java.util.Locale;

public enum AuthType {
    BEARER("bearer"),
    X_API_KEY("x_api_key"),
    API_KEY("api_key"),
    CUSTOM_HEADER("custom_header");

    private final String wireName;

    AuthType(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static AuthType parse(String value) {
        if (value != null) {
            String normalized = value.toLowerCase(Locale.ROOT);
            for (AuthType type : values()) {
                if (type.wireName.equals(normalized)) {
                    return type;
                }
            }
        }
        throw new ApiException("validation_error", "authType 不受支持。", 400, false);
    }
}

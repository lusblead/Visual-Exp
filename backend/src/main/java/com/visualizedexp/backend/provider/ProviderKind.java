package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;

import java.util.Locale;

public enum ProviderKind {
    MODEL("model"),
    SEARCH("search");

    private final String wireName;

    ProviderKind(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static ProviderKind parse(String value) {
        if (value != null) {
            for (ProviderKind kind : values()) {
                if (kind.wireName.equals(value.toLowerCase(Locale.ROOT))) {
                    return kind;
                }
            }
        }
        throw new ApiException("validation_error", "kind 不受支持。", 400, false);
    }
}

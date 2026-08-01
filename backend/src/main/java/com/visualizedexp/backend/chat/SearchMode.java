package com.visualizedexp.backend.chat;

import com.visualizedexp.backend.api.ApiException;

import java.util.Locale;

public enum SearchMode {
    OFF("off"),
    AUTO("auto"),
    FORCE("force");

    private final String wireName;

    SearchMode(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static SearchMode parse(String value) {
        if (value == null || value.isBlank()) {
            return AUTO;
        }
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            throw new ApiException(
                "validation_error",
                "searchMode 仅支持 off、auto 或 force。",
                400,
                false
            );
        }
    }
}

package com.visualizedexp.backend.chat;

public enum SearchStatus {
    DISABLED("disabled"),
    UNAVAILABLE("unavailable"),
    OFFERED("offered"),
    USED("used"),
    FAILED("failed"),
    LEGACY_UNKNOWN("legacy_unknown");

    private final String wireName;

    SearchStatus(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }
}

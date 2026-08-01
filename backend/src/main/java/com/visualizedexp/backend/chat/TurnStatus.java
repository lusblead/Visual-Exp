package com.visualizedexp.backend.chat;

public enum TurnStatus {
    PENDING("pending"),
    COMPLETED("completed"),
    FAILED("failed"),
    UNKNOWN("unknown");

    private final String wireName;

    TurnStatus(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }
}

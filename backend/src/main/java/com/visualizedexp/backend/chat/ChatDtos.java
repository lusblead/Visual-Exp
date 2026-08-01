package com.visualizedexp.backend.chat;

import com.visualizedexp.backend.search.SearchSource;

import java.util.List;

public final class ChatDtos {
    private ChatDtos() {
    }

    public record Selection(
        String nodeId,
        String text,
        String contextToken
    ) {
    }

    public record TurnRequest(
        String sessionId,
        String clientTurnId,
        String question,
        Selection selection,
        String searchMode
    ) {
    }

    public record SearchExecution(
        String mode,
        String status,
        String providerConfigId,
        int callCount
    ) {
    }

    public record Turn(
        String id,
        String clientTurnId,
        String status,
        String userText,
        String assistantText,
        String createdAt,
        String completedAt,
        List<SearchSource> sources,
        String errorCode,
        SearchExecution search
    ) {
    }

    public record TurnsResponse(List<Turn> turns) {
    }
}

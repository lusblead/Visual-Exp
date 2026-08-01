package com.visualizedexp.backend.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.common.InputRules;
import com.visualizedexp.backend.provider.UpstreamException;
import com.visualizedexp.backend.search.SearchSource;
import com.visualizedexp.backend.session.KnowledgeSessionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public final class ChatService {
    private static final Pattern CONTEXT_TOKEN =
        Pattern.compile("^ect1\\.[A-Za-z0-9_-]{43}$");

    private final ChatTurnRepository turns;
    private final KnowledgeSessionService sessions;
    private final SelectionChatModelClient model;
    private final ObjectMapper objectMapper;
    private final Duration pendingTimeout;

    public ChatService(
        ChatTurnRepository turns,
        KnowledgeSessionService sessions,
        SelectionChatModelClient model,
        ObjectMapper objectMapper,
        @Value("${app.chat.pending-timeout:5m}") Duration pendingTimeout
    ) {
        this.turns = turns;
        this.sessions = sessions;
        this.model = model;
        this.objectMapper = objectMapper;
        this.pendingTimeout = pendingTimeout;
    }

    public ChatDtos.TurnsResponse list(String ownerId, String sessionId) {
        InputRules.externalId(sessionId, "sessionId");
        String now = Instant.now().toString();
        turns.recoverStalePending(
            ownerId,
            sessionId,
            Instant.now().minus(pendingTimeout).toString(),
            now
        );
        return new ChatDtos.TurnsResponse(
            turns.list(ownerId, sessionId).stream().map(this::toDto).toList()
        );
    }

    public Submission submit(String ownerId, ChatDtos.TurnRequest request) {
        ValidatedTurn input = validate(request);
        String requestHash = hash(input);
        ChatTurnRepository.StoredTurn existing = turns.findByClientTurnId(
            ownerId,
            input.clientTurnId()
        ).orElse(null);
        if (existing != null) {
            return replay(recoverIfStale(ownerId, existing), requestHash);
        }

        sessions.ensureChatSession(ownerId, input.sessionId(), input.question());
        String now = Instant.now().toString();
        ChatTurnRepository.StoredTurn pending = new ChatTurnRepository.StoredTurn(
            UUID.randomUUID().toString(),
            input.sessionId(),
            input.clientTurnId(),
            requestHash,
            TurnStatus.PENDING,
            input.question(),
            null,
            input.selectedText(),
            input.sourceNodeId(),
            null,
            "[]",
            null,
            now,
            null,
            now,
            input.searchMode(),
            initialSearchStatus(input.searchMode()),
            null,
            0
        );
        if (!turns.insertPending(ownerId, pending)) {
            ChatTurnRepository.StoredTurn winner = turns.findByClientTurnId(
                ownerId,
                input.clientTurnId()
            ).orElseThrow(() -> new IllegalStateException(
                "Idempotent turn exists but cannot be read"
            ));
            return replay(winner, requestHash);
        }

        try {
            List<SelectionChatModelClient.HistoryTurn> history = turns.completedHistory(
                ownerId,
                input.sessionId(),
                12
            );
            SelectionChatModelClient.Completion completion = model.complete(
                ownerId,
                input.question(),
                input.selectedText(),
                history,
                input.searchMode(),
                (sources, search) -> turns.recordSearchProgress(
                    ownerId,
                    pending.id(),
                    writeSources(sources),
                    search.status(),
                    search.providerConfigId(),
                    search.callCount(),
                    Instant.now().toString()
                )
            );
            List<SearchSource> sources = completion.sources();
            String completedAt = Instant.now().toString();
            turns.complete(
                ownerId,
                pending.id(),
                completion.text(),
                completion.providerConfigId(),
                writeSources(sources),
                completion.search().status(),
                completion.search().providerConfigId(),
                completion.search().callCount(),
                completedAt
            );
            return new Submission(
                toDto(requireTurn(ownerId, input.clientTurnId())),
                200
            );
        } catch (SelectionChatModelClient.CompletionFailure exception) {
            turns.recordSearchProgress(
                ownerId,
                pending.id(),
                writeSources(exception.sources()),
                exception.search().status(),
                exception.search().providerConfigId(),
                exception.search().callCount(),
                Instant.now().toString()
            );
            return handleFailure(ownerId, pending, exception.failure());
        } catch (UpstreamException exception) {
            return handleFailure(ownerId, pending, exception);
        } catch (ApiException exception) {
            return handleFailure(ownerId, pending, exception);
        }
    }

    private Submission handleFailure(
        String ownerId,
        ChatTurnRepository.StoredTurn pending,
        RuntimeException failure
    ) {
        if (failure instanceof UpstreamException exception) {
            String failureAt = Instant.now().toString();
            if (exception.ambiguous()) {
                turns.markUnknown(ownerId, pending.id(), exception.code(), failureAt);
                return new Submission(
                    toDto(requireTurn(ownerId, pending.clientTurnId())),
                    202
                );
            }
            turns.markFailed(ownerId, pending.id(), exception.code(), failureAt);
            throw new ApiException(
                exception.code(),
                exception.getMessage(),
                exception.status(),
                exception.retryable()
            );
        }
        if (failure instanceof ApiException exception) {
            turns.markFailed(ownerId, pending.id(), exception.code(), Instant.now().toString());
            throw exception;
        }
        throw failure;
    }

    private Submission replay(
        ChatTurnRepository.StoredTurn existing,
        String requestHash
    ) {
        if (!MessageDigest.isEqual(
            existing.requestHash().getBytes(StandardCharsets.US_ASCII),
            requestHash.getBytes(StandardCharsets.US_ASCII)
        )) {
            throw new ApiException(
                "idempotency_conflict",
                "clientTurnId 已用于不同请求。",
                409,
                false
            );
        }
        if (existing.status() == TurnStatus.FAILED) {
            throw new ApiException(
                "turn_already_failed",
                "该幂等请求已经失败；请在修正配置后使用新的 clientTurnId。",
                409,
                false
            );
        }
        int status = existing.status() == TurnStatus.COMPLETED ? 200 : 202;
        return new Submission(toDto(existing), status);
    }

    private ChatTurnRepository.StoredTurn requireTurn(String ownerId, String clientTurnId) {
        return turns.findByClientTurnId(ownerId, clientTurnId)
            .orElseThrow(() -> new IllegalStateException("Chat turn disappeared"));
    }

    private ValidatedTurn validate(ChatDtos.TurnRequest request) {
        if (request == null || request.selection() == null) {
            throw new ApiException(
                "validation_error",
                "selection 为必填项。",
                400,
                false
            );
        }
        String sessionId = InputRules.externalId(request.sessionId(), "sessionId");
        String clientTurnId = InputRules.externalId(
            request.clientTurnId(),
            "clientTurnId"
        );
        String question = InputRules.boundedText(request.question(), 4000, "question");
        String nodeId = InputRules.nodeId(request.selection().nodeId());
        String selectedText = InputRules.boundedText(
            request.selection().text(),
            600,
            "selection.text"
        );
        String contextToken = request.selection().contextToken();
        if (contextToken != null
            && !contextToken.isBlank()
            && !CONTEXT_TOKEN.matcher(contextToken).matches()) {
            throw new ApiException(
                "validation_error",
                "selection.contextToken 格式无效。",
                400,
                false
            );
        }
        return new ValidatedTurn(
            sessionId,
            clientTurnId,
            question,
            nodeId,
            selectedText,
            contextToken == null ? "" : contextToken,
            SearchMode.parse(request.searchMode())
        );
    }

    private String hash(ValidatedTurn input) {
        try {
            String canonical = objectMapper.writeValueAsString(input);
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(canonical.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (JsonProcessingException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Unable to hash idempotent turn", exception);
        }
    }

    private ChatDtos.Turn toDto(ChatTurnRepository.StoredTurn turn) {
        return new ChatDtos.Turn(
            turn.id(),
            turn.clientTurnId(),
            turn.status().wireName(),
            turn.userText(),
            turn.assistantText(),
            turn.createdAt(),
            turn.completedAt(),
            readSources(turn.sourcesJson()),
            turn.errorCode(),
            new ChatDtos.SearchExecution(
                turn.searchMode().wireName(),
                turn.searchStatus().wireName(),
                turn.searchProviderConfigId(),
                turn.searchCallCount()
            )
        );
    }

    private String writeSources(List<SearchSource> sources) {
        try {
            return objectMapper.writeValueAsString(sources);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException("Unable to store normalized search sources", impossible);
        }
    }

    private List<SearchSource> readSources(String value) {
        try {
            return objectMapper.readValue(value, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored search sources are corrupt", exception);
        }
    }

    private ChatTurnRepository.StoredTurn recoverIfStale(
        String ownerId,
        ChatTurnRepository.StoredTurn turn
    ) {
        if (turn.status() == TurnStatus.PENDING
            && Instant.parse(turn.updatedAt()).isBefore(Instant.now().minus(pendingTimeout))) {
            turns.markUnknown(
                ownerId,
                turn.id(),
                "turn_recovered_after_restart",
                Instant.now().toString()
            );
            return requireTurn(ownerId, turn.clientTurnId());
        }
        return turn;
    }

    public record Submission(ChatDtos.Turn turn, int httpStatus) {
    }

    private static SearchStatus initialSearchStatus(SearchMode mode) {
        return mode == SearchMode.OFF
            ? SearchStatus.DISABLED
            : SearchStatus.OFFERED;
    }

    private record ValidatedTurn(
        String sessionId,
        String clientTurnId,
        String question,
        String sourceNodeId,
        String selectedText,
        String contextToken,
        SearchMode searchMode
    ) {
    }
}

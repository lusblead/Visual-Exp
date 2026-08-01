package com.visualizedexp.backend.chat;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.ArrayList;
import java.util.Collections;

@Repository
public class ChatTurnRepository {
    private final JdbcTemplate jdbc;

    public ChatTurnRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean insertPending(String ownerId, StoredTurn turn) {
        try {
            jdbc.update(
                """
                INSERT INTO chat_turns (
                    owner_id, turn_id, session_id, client_turn_id, request_hash,
                    status, user_text, assistant_text, selected_text, source_node_id,
                    provider_config_id, sources_json, error_code, created_at,
                    completed_at, updated_at, search_mode, search_status,
                    search_provider_config_id, search_call_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, '[]', NULL, ?, NULL, ?,
                          ?, ?, NULL, 0)
                """,
                ownerId,
                turn.id(),
                turn.sessionId(),
                turn.clientTurnId(),
                turn.requestHash(),
                TurnStatus.PENDING.name(),
                turn.userText(),
                turn.selectedText(),
                turn.sourceNodeId(),
                turn.createdAt(),
                turn.updatedAt(),
                turn.searchMode().name(),
                turn.searchStatus().name()
            );
            return true;
        } catch (DuplicateKeyException exception) {
            return false;
        }
    }

    public Optional<StoredTurn> findByClientTurnId(String ownerId, String clientTurnId) {
        return query(
            """
            SELECT turn_id, session_id, client_turn_id, request_hash, status,
                   user_text, assistant_text, selected_text, source_node_id,
                   provider_config_id, sources_json, error_code, created_at,
                   completed_at, updated_at, search_mode, search_status,
                   search_provider_config_id, search_call_count
              FROM chat_turns
             WHERE owner_id = ? AND client_turn_id = ?
            """,
            ownerId,
            clientTurnId
        ).stream().findFirst();
    }

    public List<StoredTurn> list(String ownerId, String sessionId) {
        return query(
            """
            SELECT *
              FROM (
                    SELECT turn_id, session_id, client_turn_id, request_hash, status,
                           user_text, assistant_text, selected_text, source_node_id,
                           provider_config_id, sources_json, error_code, created_at,
                           completed_at, updated_at, search_mode, search_status,
                           search_provider_config_id, search_call_count
                      FROM chat_turns
                     WHERE owner_id = ? AND session_id = ?
                     ORDER BY created_at DESC, turn_id DESC
                     LIMIT 200
                   ) recent_turns
             ORDER BY created_at ASC, turn_id ASC
            """,
            ownerId,
            sessionId
        );
    }

    public void recoverStalePending(
        String ownerId,
        String sessionId,
        String cutoff,
        String recoveredAt
    ) {
        jdbc.update(
            """
            UPDATE chat_turns
               SET status = ?,
                   error_code = ?,
                   search_status = CASE
                       WHEN search_status IN (
                           'DISABLED',
                           'UNAVAILABLE',
                           'OFFERED',
                           'USED',
                           'LEGACY_UNKNOWN'
                       ) THEN search_status
                       ELSE 'FAILED'
                   END,
                   updated_at = ?
             WHERE owner_id = ?
               AND session_id = ?
               AND status = ?
               AND updated_at < ?
            """,
            TurnStatus.UNKNOWN.name(),
            "turn_recovered_after_restart",
            recoveredAt,
            ownerId,
            sessionId,
            TurnStatus.PENDING.name(),
            cutoff
        );
    }

    public List<SelectionChatModelClient.HistoryTurn> completedHistory(
        String ownerId,
        String sessionId,
        int limit
    ) {
        List<SelectionChatModelClient.HistoryTurn> newestFirst = jdbc.query(
            """
            SELECT user_text, assistant_text
              FROM chat_turns
             WHERE owner_id = ? AND session_id = ? AND status = ?
             ORDER BY created_at DESC
             LIMIT ?
            """,
            (resultSet, rowNumber) -> new SelectionChatModelClient.HistoryTurn(
                resultSet.getString("user_text"),
                resultSet.getString("assistant_text")
            ),
            ownerId,
            sessionId,
            TurnStatus.COMPLETED.name(),
            limit
        );
        List<SelectionChatModelClient.HistoryTurn> chronological =
            new ArrayList<>(newestFirst);
        Collections.reverse(chronological);
        return chronological;
    }

    public void complete(
        String ownerId,
        String turnId,
        String assistantText,
        String providerConfigId,
        String sourcesJson,
        SearchStatus searchStatus,
        String searchProviderConfigId,
        int searchCallCount,
        String completedAt
    ) {
        int changed = jdbc.update(
            """
            UPDATE chat_turns
               SET status = ?,
                   assistant_text = ?,
                   provider_config_id = ?,
                   sources_json = ?,
                   search_status = ?,
                   search_provider_config_id = ?,
                   search_call_count = ?,
                   completed_at = ?,
                   updated_at = ?
             WHERE owner_id = ? AND turn_id = ? AND status = ?
            """,
            TurnStatus.COMPLETED.name(),
            assistantText,
            providerConfigId,
            sourcesJson,
            searchStatus.name(),
            searchProviderConfigId,
            searchCallCount,
            completedAt,
            completedAt,
            ownerId,
            turnId,
            TurnStatus.PENDING.name()
        );
        requireTransition(changed);
    }

    public void recordSearchProgress(
        String ownerId,
        String turnId,
        String sourcesJson,
        SearchStatus searchStatus,
        String searchProviderConfigId,
        int searchCallCount,
        String updatedAt
    ) {
        int changed = jdbc.update(
            """
            UPDATE chat_turns
               SET sources_json = ?,
                   search_status = ?,
                   search_provider_config_id = ?,
                   search_call_count = ?,
                   updated_at = ?
             WHERE owner_id = ? AND turn_id = ? AND status = ?
            """,
            sourcesJson,
            searchStatus.name(),
            searchProviderConfigId,
            searchCallCount,
            updatedAt,
            ownerId,
            turnId,
            TurnStatus.PENDING.name()
        );
        requireTransition(changed);
    }

    public void markUnknown(String ownerId, String turnId, String code, String updatedAt) {
        transition(ownerId, turnId, TurnStatus.UNKNOWN, code, updatedAt);
    }

    public void markFailed(String ownerId, String turnId, String code, String updatedAt) {
        transition(ownerId, turnId, TurnStatus.FAILED, code, updatedAt);
    }

    private void transition(
        String ownerId,
        String turnId,
        TurnStatus status,
        String code,
        String updatedAt
    ) {
        int changed = jdbc.update(
            """
            UPDATE chat_turns
               SET status = ?,
                   error_code = ?,
                   search_status = CASE
                       WHEN search_status IN (
                           'DISABLED',
                           'UNAVAILABLE',
                           'OFFERED',
                           'USED',
                           'LEGACY_UNKNOWN'
                       ) THEN search_status
                       ELSE 'FAILED'
                   END,
                   updated_at = ?
             WHERE owner_id = ? AND turn_id = ? AND status = ?
            """,
            status.name(),
            code,
            updatedAt,
            ownerId,
            turnId,
            TurnStatus.PENDING.name()
        );
        requireTransition(changed);
    }

    private List<StoredTurn> query(String sql, Object... arguments) {
        return jdbc.query(
            sql,
            (resultSet, rowNumber) -> new StoredTurn(
                resultSet.getString("turn_id"),
                resultSet.getString("session_id"),
                resultSet.getString("client_turn_id"),
                resultSet.getString("request_hash"),
                TurnStatus.valueOf(resultSet.getString("status")),
                resultSet.getString("user_text"),
                resultSet.getString("assistant_text"),
                resultSet.getString("selected_text"),
                resultSet.getString("source_node_id"),
                resultSet.getString("provider_config_id"),
                resultSet.getString("sources_json"),
                resultSet.getString("error_code"),
                resultSet.getString("created_at"),
                resultSet.getString("completed_at"),
                resultSet.getString("updated_at"),
                SearchMode.valueOf(resultSet.getString("search_mode")),
                SearchStatus.valueOf(resultSet.getString("search_status")),
                resultSet.getString("search_provider_config_id"),
                resultSet.getInt("search_call_count")
            ),
            arguments
        );
    }

    private static void requireTransition(int changed) {
        if (changed != 1) {
            throw new IllegalStateException("Chat turn state transition was not applied");
        }
    }

    public record StoredTurn(
        String id,
        String sessionId,
        String clientTurnId,
        String requestHash,
        TurnStatus status,
        String userText,
        String assistantText,
        String selectedText,
        String sourceNodeId,
        String providerConfigId,
        String sourcesJson,
        String errorCode,
        String createdAt,
        String completedAt,
        String updatedAt,
        SearchMode searchMode,
        SearchStatus searchStatus,
        String searchProviderConfigId,
        int searchCallCount
    ) {
    }
}

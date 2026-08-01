package com.visualizedexp.backend.session;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class KnowledgeSessionRepository {
    private final JdbcTemplate jdbc;

    public KnowledgeSessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void ensurePlaceholder(String ownerId, String sessionId, String question) {
        if (exists(ownerId, sessionId)) {
            return;
        }
        String now = Instant.now().toString();
        try {
            jdbc.update(
                """
                INSERT INTO knowledge_sessions (
                    owner_id, session_id, protocol, title, question, client_revision,
                    payload_json, placeholder, active, active_slot, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 0, NULL, TRUE, FALSE, NULL, ?, ?)
                """,
                ownerId,
                sessionId,
                KnowledgeSessionValidator.PROTOCOL,
                "AI 对话",
                question,
                now,
                now
            );
        } catch (DuplicateKeyException ignored) {
            // Another request created the same owner-scoped placeholder.
        }
    }

    @Transactional
    public boolean save(
        String ownerId,
        KnowledgeSessionValidator.ValidatedSession session
    ) {
        int changed = jdbc.update(
            """
            UPDATE knowledge_sessions
               SET protocol = ?,
                   title = ?,
                   question = ?,
                   client_revision = ?,
                   payload_json = ?,
                   placeholder = FALSE,
                   created_at = ?,
                   updated_at = ?
             WHERE owner_id = ?
               AND session_id = ?
               AND (placeholder = TRUE OR client_revision < ?)
            """,
            KnowledgeSessionValidator.PROTOCOL,
            session.title(),
            session.question(),
            session.revision(),
            session.payloadJson(),
            session.createdAt(),
            session.updatedAt(),
            ownerId,
            session.id(),
            session.revision()
        );
        if (changed == 1) {
            activate(ownerId, session.id());
            return true;
        }
        return false;
    }

    public Optional<StoredSession> find(String ownerId, String sessionId) {
        List<StoredSession> rows = jdbc.query(
            """
            SELECT session_id, title, question, client_revision, payload_json,
                   placeholder, created_at, updated_at
              FROM knowledge_sessions
             WHERE owner_id = ? AND session_id = ?
            """,
            (resultSet, rowNumber) -> map(resultSet),
            ownerId,
            sessionId
        );
        return rows.stream().findFirst();
    }

    public List<StoredSession> listComplete(String ownerId, int limit) {
        return jdbc.query(
            """
            SELECT session_id, title, question, client_revision, payload_json,
                   placeholder, created_at, updated_at
              FROM knowledge_sessions
             WHERE owner_id = ? AND placeholder = FALSE
             ORDER BY updated_at DESC, session_id DESC
             LIMIT ?
            """,
            (resultSet, rowNumber) -> map(resultSet),
            ownerId,
            limit
        );
    }

    public Optional<String> activeId(String ownerId) {
        List<String> values = jdbc.query(
            """
            SELECT session_id
             FROM knowledge_sessions
             WHERE owner_id = ? AND active_slot = 'ACTIVE' AND placeholder = FALSE
             ORDER BY updated_at DESC
             LIMIT 1
            """,
            (resultSet, rowNumber) -> resultSet.getString(1),
            ownerId
        );
        return values.stream().findFirst();
    }

    @Transactional
    public void activate(String ownerId, String sessionId) {
        jdbc.update(
            """
            UPDATE knowledge_sessions
               SET active = FALSE, active_slot = NULL
             WHERE owner_id = ? AND active_slot = 'ACTIVE'
            """,
            ownerId
        );
        int changed = jdbc.update(
            """
            UPDATE knowledge_sessions
               SET active = TRUE, active_slot = 'ACTIVE'
             WHERE owner_id = ? AND session_id = ? AND placeholder = FALSE
            """,
            ownerId,
            sessionId
        );
        if (changed != 1) {
            throw new IllegalStateException("Cannot activate a missing knowledge session");
        }
    }

    @Transactional
    public void delete(String ownerId, String sessionId) {
        jdbc.update(
            "DELETE FROM chat_turns WHERE owner_id = ? AND session_id = ?",
            ownerId,
            sessionId
        );
        jdbc.update(
            "DELETE FROM knowledge_sessions WHERE owner_id = ? AND session_id = ?",
            ownerId,
            sessionId
        );
    }

    private boolean exists(String ownerId, String sessionId) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM knowledge_sessions WHERE owner_id = ? AND session_id = ?",
            Integer.class,
            ownerId,
            sessionId
        );
        return count != null && count > 0;
    }

    private static StoredSession map(java.sql.ResultSet resultSet)
        throws java.sql.SQLException {
        return new StoredSession(
            resultSet.getString("session_id"),
            resultSet.getString("title"),
            resultSet.getString("question"),
            resultSet.getLong("client_revision"),
            resultSet.getString("payload_json"),
            resultSet.getBoolean("placeholder"),
            resultSet.getString("created_at"),
            resultSet.getString("updated_at")
        );
    }

    public record StoredSession(
        String id,
        String title,
        String question,
        long clientRevision,
        String payloadJson,
        boolean placeholder,
        String createdAt,
        String updatedAt
    ) {
    }
}

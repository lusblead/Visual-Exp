package com.visualizedexp.backend.session;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.common.InputRules;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public final class KnowledgeSessionService {
    private final KnowledgeSessionRepository repository;
    private final KnowledgeSessionValidator validator;
    private final ObjectMapper objectMapper;
    private final int listLimit;

    public KnowledgeSessionService(
        KnowledgeSessionRepository repository,
        KnowledgeSessionValidator validator,
        ObjectMapper objectMapper,
        @Value("${app.sessions.list-limit:60}") int listLimit
    ) {
        this.repository = repository;
        this.validator = validator;
        this.objectMapper = objectMapper;
        this.listLimit = Math.max(1, Math.min(listLimit, 50));
    }

    public SessionDtos.RestoreResponse restore(String ownerId) {
        List<KnowledgeSessionRepository.StoredSession> rows = repository.listComplete(
            ownerId,
            listLimit
        );
        JsonNode active = repository.activeId(ownerId)
            .flatMap(id -> rows.stream().filter(row -> row.id().equals(id)).findFirst())
            .map(this::payload)
            .orElseGet(() -> rows.isEmpty() ? null : payload(rows.get(0)));
        return new SessionDtos.RestoreResponse(
            active,
            rows.stream().map(this::summary).toList(),
            List.of()
        );
    }

    public SessionDtos.ListResponse list(String ownerId) {
        return new SessionDtos.ListResponse(
            repository.listComplete(ownerId, listLimit).stream().map(this::summary).toList()
        );
    }

    public SessionDtos.ReadResponse read(String ownerId, String sessionId) {
        InputRules.externalId(sessionId, "sessionId");
        JsonNode value = repository.find(ownerId, sessionId)
            .filter(row -> !row.placeholder())
            .map(this::payload)
            .orElse(null);
        return new SessionDtos.ReadResponse(value);
    }

    public SessionDtos.SaveResponse save(String ownerId, String sessionId, JsonNode body) {
        KnowledgeSessionValidator.ValidatedSession session = validator.validate(sessionId, body);
        repository.ensurePlaceholder(ownerId, sessionId, session.question());
        boolean saved = repository.save(ownerId, session);
        return new SessionDtos.SaveResponse(
            saved,
            !saved,
            repository.listComplete(ownerId, listLimit).stream().map(this::summary).toList()
        );
    }

    public void activate(String ownerId, String sessionId) {
        InputRules.externalId(sessionId, "sessionId");
        KnowledgeSessionRepository.StoredSession row = repository.find(ownerId, sessionId)
            .filter(candidate -> !candidate.placeholder())
            .orElseThrow(() -> new ApiException(
                "knowledge_session_not_found",
                "历史会话不存在。",
                404,
                false
            ));
        repository.activate(ownerId, row.id());
    }

    public void delete(String ownerId, String sessionId) {
        InputRules.externalId(sessionId, "sessionId");
        repository.delete(ownerId, sessionId);
    }

    public void ensureChatSession(String ownerId, String sessionId, String question) {
        InputRules.externalId(sessionId, "sessionId");
        repository.ensurePlaceholder(ownerId, sessionId, question);
    }

    private SessionDtos.Summary summary(KnowledgeSessionRepository.StoredSession row) {
        return new SessionDtos.Summary(row.id(), row.question(), row.title(), row.updatedAt());
    }

    private JsonNode payload(KnowledgeSessionRepository.StoredSession row) {
        try {
            return objectMapper.readTree(row.payloadJson());
        } catch (JsonProcessingException exception) {
            throw new ApiException(
                "knowledge_session_corrupt",
                "历史会话无法读取。",
                500,
                false
            );
        }
    }
}

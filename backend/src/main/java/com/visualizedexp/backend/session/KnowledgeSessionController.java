package com.visualizedexp.backend.session;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizedexp.backend.auth.OwnerIdentity;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public final class KnowledgeSessionController {
    private final KnowledgeSessionService service;
    private final OwnerIdentity ownerIdentity;

    public KnowledgeSessionController(
        KnowledgeSessionService service,
        OwnerIdentity ownerIdentity
    ) {
        this.service = service;
        this.ownerIdentity = ownerIdentity;
    }

    @GetMapping("/api/v1/sessions/restore")
    SessionDtos.RestoreResponse restore(HttpServletRequest request) {
        return service.restore(ownerIdentity.require(request));
    }

    @GetMapping("/api/v1/sessions")
    SessionDtos.ListResponse list(HttpServletRequest request) {
        return service.list(ownerIdentity.require(request));
    }

    @GetMapping("/api/v1/sessions/{sessionId}")
    SessionDtos.ReadResponse read(
        @PathVariable String sessionId,
        HttpServletRequest request
    ) {
        return service.read(ownerIdentity.require(request), sessionId);
    }

    @PutMapping("/api/v1/sessions/{sessionId}")
    SessionDtos.SaveResponse save(
        @PathVariable String sessionId,
        @RequestBody JsonNode session,
        HttpServletRequest request
    ) {
        return service.save(ownerIdentity.require(request), sessionId, session);
    }

    @PostMapping("/api/v1/sessions/{sessionId}/activate")
    ResponseEntity<Void> activate(
        @PathVariable String sessionId,
        HttpServletRequest request
    ) {
        service.activate(ownerIdentity.require(request), sessionId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/api/v1/sessions/{sessionId}")
    ResponseEntity<Void> delete(
        @PathVariable String sessionId,
        HttpServletRequest request
    ) {
        service.delete(ownerIdentity.require(request), sessionId);
        return ResponseEntity.noContent().build();
    }
}

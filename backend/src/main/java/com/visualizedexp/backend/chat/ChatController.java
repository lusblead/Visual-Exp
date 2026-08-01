package com.visualizedexp.backend.chat;

import com.visualizedexp.backend.auth.OwnerIdentity;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public final class ChatController {
    private final ChatService service;
    private final OwnerIdentity ownerIdentity;

    public ChatController(ChatService service, OwnerIdentity ownerIdentity) {
        this.service = service;
        this.ownerIdentity = ownerIdentity;
    }

    @GetMapping("/api/v1/chat/sessions/{sessionId}/turns")
    ChatDtos.TurnsResponse list(
        @PathVariable String sessionId,
        HttpServletRequest request
    ) {
        return service.list(ownerIdentity.require(request), sessionId);
    }

    @PostMapping("/api/v1/chat/turns")
    ResponseEntity<ChatDtos.Turn> submit(
        @RequestBody ChatDtos.TurnRequest body,
        HttpServletRequest request
    ) {
        ChatService.Submission submission = service.submit(
            ownerIdentity.require(request),
            body
        );
        return ResponseEntity.status(submission.httpStatus()).body(submission.turn());
    }
}

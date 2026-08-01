package com.visualizedexp.backend.provider;

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
public final class ProviderController {
    private final ProviderService service;
    private final OwnerIdentity ownerIdentity;

    public ProviderController(ProviderService service, OwnerIdentity ownerIdentity) {
        this.service = service;
        this.ownerIdentity = ownerIdentity;
    }

    @GetMapping("/api/v1/providers")
    ProviderDtos.ListResponse list(HttpServletRequest request) {
        return service.list(ownerIdentity.require(request));
    }

    @PostMapping("/api/v1/providers")
    ResponseEntity<ProviderDtos.WriteResponse> create(
        @RequestBody ProviderDtos.WriteRequest body,
        HttpServletRequest request
    ) {
        ProviderDtos.Summary provider = service.create(ownerIdentity.require(request), body);
        return ResponseEntity.status(201).body(new ProviderDtos.WriteResponse(provider));
    }

    @PutMapping("/api/v1/providers/{configId}")
    ProviderDtos.WriteResponse update(
        @PathVariable String configId,
        @RequestBody ProviderDtos.WriteRequest body,
        HttpServletRequest request
    ) {
        return new ProviderDtos.WriteResponse(
            service.update(ownerIdentity.require(request), configId, body)
        );
    }

    @PostMapping("/api/v1/providers/{configId}/activate")
    ProviderDtos.WriteResponse activate(
        @PathVariable String configId,
        HttpServletRequest request
    ) {
        return new ProviderDtos.WriteResponse(
            service.activate(ownerIdentity.require(request), configId)
        );
    }

    @DeleteMapping("/api/v1/providers/{configId}")
    ResponseEntity<Void> delete(
        @PathVariable String configId,
        HttpServletRequest request
    ) {
        service.delete(ownerIdentity.require(request), configId);
        return ResponseEntity.noContent().build();
    }
}

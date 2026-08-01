package com.visualizedexp.backend.auth;

import com.visualizedexp.backend.api.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.Locale;

@Component
public final class OwnerIdentity {
    private final String ownerHeader;
    private final String defaultOwner;

    public OwnerIdentity(
        @Value("${app.auth.owner-header}") String ownerHeader,
        @Value("${app.auth.default-owner:}") String defaultOwner
    ) {
        this.ownerHeader = ownerHeader;
        this.defaultOwner = defaultOwner;
    }

    public String require(HttpServletRequest request) {
        String raw = request.getHeader(ownerHeader);
        if (raw == null || raw.isBlank()) {
            raw = defaultOwner;
        }
        if (raw == null || raw.isBlank()) {
            throw new ApiException(
                "authentication_required",
                "需要已认证的用户身份。",
                401,
                false
            );
        }
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        if (normalized.length() > 320 || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new ApiException("invalid_owner_identity", "用户身份格式无效。", 400, false);
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(normalized.getBytes(StandardCharsets.UTF_8));
            return "owner_" + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}

package com.visualizedexp.backend.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.api.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

@Component
public final class InternalTokenFilter extends OncePerRequestFilter {
    private final byte[] expected;
    private final ObjectMapper objectMapper;

    public InternalTokenFilter(
        @Value("${app.auth.internal-token:}") String internalToken,
        @Value("${server.address:127.0.0.1}") String bindAddress,
        ObjectMapper objectMapper
    ) {
        if (!isLoopback(bindAddress) && internalToken.trim().length() < 16) {
            throw new IllegalStateException(
                "APP_INTERNAL_TOKEN must contain at least 16 characters "
                    + "when the backend is not bound to loopback"
            );
        }
        this.expected = internalToken.getBytes(StandardCharsets.UTF_8);
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return "/api/v1/health".equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        if (expected.length == 0) {
            filterChain.doFilter(request, response);
            return;
        }
        String authorization = request.getHeader("Authorization");
        byte[] actual = authorization != null && authorization.startsWith("Bearer ")
            ? authorization.substring(7).getBytes(StandardCharsets.UTF_8)
            : new byte[0];
        if (!MessageDigest.isEqual(expected, actual)) {
            response.setStatus(401);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(
                response.getOutputStream(),
                new ApiError(
                    "backend_authentication_failed",
                    "后端服务认证失败。",
                    false,
                    UUID.randomUUID().toString()
                )
            );
            return;
        }
        filterChain.doFilter(request, response);
    }

    private static boolean isLoopback(String value) {
        String address = value == null ? "" : value.trim();
        return "127.0.0.1".equals(address)
            || "::1".equals(address)
            || "[::1]".equals(address)
            || "localhost".equalsIgnoreCase(address);
    }
}

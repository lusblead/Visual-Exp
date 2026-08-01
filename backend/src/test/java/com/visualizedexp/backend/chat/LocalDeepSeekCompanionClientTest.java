package com.visualizedexp.backend.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.visualizedexp.backend.api.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LocalDeepSeekCompanionClientTest {
    private static final String TOKEN = "launcher-token-with-safe-length";

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void acceptsOnlyOneExactIpv4LoopbackOrigin() {
        for (String origin : new String[] {
            "http://localhost:43123",
            "http://127.0.0.1",
            "https://127.0.0.1:43123",
            "http://user@127.0.0.1:43123",
            "http://127.0.0.1:43123/v1",
            "http://127.0.0.1:43123?target=other",
            "http://127.0.0.2:43123",
            "http://[::1]:43123",
        }) {
            assertThatThrownBy(() -> client(true, origin, TOKEN))
                .as(origin)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("fixed loopback origin");
        }

        LocalDeepSeekCompanionClient disabled = client(
            false,
            "https://not-used.example",
            "not-used"
        );
        assertThat(disabled.isCredentialConfigured()).isFalse();
    }

    @Test
    void usesFixedStatusAndChatPathsWithTheLauncherBearer() throws Exception {
        AtomicReference<String> statusAuthorization = new AtomicReference<>();
        AtomicReference<String> chatAuthorization = new AtomicReference<>();
        AtomicReference<String> chatMethod = new AtomicReference<>();
        AtomicReference<String> chatBody = new AtomicReference<>();
        server = loopbackServer();
        server.createContext("/v1/status", exchange -> {
            statusAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(
                exchange,
                200,
                """
                {
                  "configured": true,
                  "provider": "deepseek",
                  "model": "deepseek-v4-pro",
                  "storage": "windows_credential_manager"
                }
                """
            );
        });
        server.createContext("/v1/deepseek/chat/completions", exchange -> {
            chatAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            chatMethod.set(exchange.getRequestMethod());
            chatBody.set(new String(
                exchange.getRequestBody().readAllBytes(),
                StandardCharsets.UTF_8
            ));
            respond(
                exchange,
                200,
                """
                {"choices":[{"message":{"content":"ok"}}]}
                """
            );
        });
        server.start();

        LocalDeepSeekCompanionClient client = client(
            true,
            origin(server),
            TOKEN
        );

        assertThat(client.isCredentialConfigured()).isTrue();
        assertThat(client.sendChat(
            "{\"model\":\"deepseek-v4-pro\",\"messages\":[]}"
        )).contains("\"content\":\"ok\"");
        assertThat(statusAuthorization.get()).isEqualTo("Bearer " + TOKEN);
        assertThat(chatAuthorization.get()).isEqualTo("Bearer " + TOKEN);
        assertThat(chatMethod.get()).isEqualTo("POST");
        assertThat(chatBody.get()).contains("\"model\":\"deepseek-v4-pro\"");
        assertThat(client.toString()).doesNotContain(TOKEN);
    }

    @Test
    void mapsMissingCredentialWithoutReturningTheCompanionMessage() throws Exception {
        String upstreamSentinel = "do-not-return-this-companion-message";
        server = loopbackServer();
        server.createContext("/v1/deepseek/chat/completions", exchange -> respond(
            exchange,
            409,
            """
            {"error":{"code":"credential_required","message":"%s"}}
            """.formatted(upstreamSentinel)
        ));
        server.start();

        LocalDeepSeekCompanionClient client = client(
            true,
            origin(server),
            TOKEN
        );

        assertThatThrownBy(() -> client.sendChat(
            "{\"model\":\"deepseek-v4-pro\",\"messages\":[]}"
        ))
            .isInstanceOf(ApiException.class)
            .satisfies(exception -> {
                ApiException api = (ApiException) exception;
                assertThat(api.code()).isEqualTo("provider_not_configured");
                assertThat(api.status()).isEqualTo(409);
                assertThat(api.getMessage()).doesNotContain(upstreamSentinel);
            });
    }

    private static LocalDeepSeekCompanionClient client(
        boolean enabled,
        String origin,
        String token
    ) {
        return new LocalDeepSeekCompanionClient(
            enabled,
            origin,
            token,
            Duration.ofSeconds(2),
            Duration.ofSeconds(5),
            new ObjectMapper()
        );
    }

    private static HttpServer loopbackServer() throws IOException {
        return HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    }

    private static String origin(HttpServer server) {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static void respond(
        HttpExchange exchange,
        int status,
        String body
    ) throws IOException {
        byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set(
            "Content-Type",
            "application/json; charset=utf-8"
        );
        exchange.sendResponseHeaders(status, encoded.length);
        exchange.getResponseBody().write(encoded);
        exchange.close();
    }
}

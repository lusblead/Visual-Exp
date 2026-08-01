package com.visualizedexp.backend.provider;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.search.SearchProvider;
import com.visualizedexp.backend.search.SearchProviderRegistry;
import org.junit.jupiter.api.Test;

import java.net.http.HttpRequest;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProviderVerifierTest {
    @Test
    void verifiesOpenAiAgainstTheExactConfiguredEndpointAndFixedApiKeyHeader() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        AtomicReference<HttpRequest> captured = new AtomicReference<>();
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenAnswer(
            invocation -> {
                captured.set(((HttpRequest.Builder) invocation.getArgument(0)).build());
                return new SafeHttpClient.Response(
                    200,
                    "{\"choices\":[{\"message\":{\"content\":\"O\"}}]}"
                );
            }
        );
        ProviderVerifier verifier = verifier(http);
        ProviderService.PlainProvider provider = provider(
            ProviderType.GEMINI,
            "https://gateway.example.com/exact/generate",
            ApiFormat.OPENAI_CHAT_COMPLETIONS,
            EndpointMode.FULL_URL,
            AuthType.API_KEY,
            null
        );

        assertThatCode(() -> verifier.verify(provider)).doesNotThrowAnyException();

        HttpRequest request = captured.get();
        assertThat(request.uri()).hasToString(
            "https://gateway.example.com/exact/generate"
        );
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.headers().firstValue("api-key"))
            .contains("secret");
        assertThat(request.headers().firstValue("Authorization")).isEmpty();
    }

    @Test
    void verifiesAnthropicMessagesAtTheDerivedEndpointWithNativeHeaders() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        AtomicReference<HttpRequest> captured = new AtomicReference<>();
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenAnswer(
            invocation -> {
                captured.set(((HttpRequest.Builder) invocation.getArgument(0)).build());
                return new SafeHttpClient.Response(
                    200,
                    "{\"content\":[{\"type\":\"text\",\"text\":\"O\"}]}"
                );
            }
        );
        ProviderVerifier verifier = verifier(http);
        ProviderService.PlainProvider provider = provider(
            ProviderType.ANTHROPIC,
            "https://api.anthropic.com",
            ApiFormat.ANTHROPIC_MESSAGES,
            EndpointMode.BASE_URL,
            AuthType.X_API_KEY,
            null
        );

        assertThatCode(() -> verifier.verify(provider)).doesNotThrowAnyException();

        HttpRequest request = captured.get();
        assertThat(request.uri()).hasToString("https://api.anthropic.com/v1/messages");
        assertThat(request.headers().firstValue("x-api-key")).contains("secret");
        assertThat(request.headers().firstValue("anthropic-version"))
            .contains(ProviderAuthentication.ANTHROPIC_VERSION);
    }

    @Test
    void verifiesOpenAiCompatibleProviderWithRestrictedCustomHeader() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        AtomicReference<HttpRequest> captured = new AtomicReference<>();
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenAnswer(
            invocation -> {
                captured.set(((HttpRequest.Builder) invocation.getArgument(0)).build());
                return new SafeHttpClient.Response(
                    200,
                    "{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}"
                );
            }
        );
        ProviderVerifier verifier = verifier(http);
        ProviderService.PlainProvider provider = provider(
            ProviderType.CUSTOM_OPENAI_COMPATIBLE,
            "https://gateway.example.com/v1",
            ApiFormat.OPENAI_CHAT_COMPLETIONS,
            EndpointMode.BASE_URL,
            AuthType.CUSTOM_HEADER,
            "X-Provider-Token"
        );

        assertThatCode(() -> verifier.verify(provider)).doesNotThrowAnyException();

        HttpRequest request = captured.get();
        assertThat(request.uri()).hasToString(
            "https://gateway.example.com/v1/chat/completions"
        );
        assertThat(request.headers().firstValue("X-Provider-Token"))
            .contains("secret");
        assertThat(request.headers().firstValue("Authorization")).isEmpty();
    }

    @Test
    void acceptsOnlyFormatSpecificSuccessfulVerificationResponses() {
        SafeHttpClient http = mock(SafeHttpClient.class);
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenReturn(
            new SafeHttpClient.Response(200, "{\"data\":[]}"),
            new SafeHttpClient.Response(200, "[]"),
            new SafeHttpClient.Response(401, "{}")
        );
        ProviderVerifier verifier = verifier(http);
        ProviderService.PlainProvider provider = provider(
            ProviderType.OPENAI,
            "https://api.openai.com/v1",
            ApiFormat.OPENAI_CHAT_COMPLETIONS,
            EndpointMode.BASE_URL,
            AuthType.BEARER,
            null
        );

        assertThatThrownBy(() -> verifier.verify(provider))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_response_invalid"));

        assertThatThrownBy(() -> verifier.verify(provider))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_response_invalid"));

        assertThatThrownBy(() -> verifier.verify(provider))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("credential_invalid"));
    }

    @Test
    void rejectsVerificationResponsesThatEchoTheCandidateCredential() {
        String candidateCredential = "unit-test-provider-secret";
        SafeHttpClient http = mock(SafeHttpClient.class);
        when(http.send(any(HttpRequest.Builder.class), eq(false))).thenReturn(
            new SafeHttpClient.Response(
                200,
                "{\"choices\":[{\"message\":{\"content\":\""
                    + candidateCredential
                    + "\"}}]}"
            )
        );
        ProviderVerifier verifier = verifier(http);
        ProviderService.PlainProvider provider =
            new ProviderService.PlainProvider(
                "provider-1",
                ProviderKind.MODEL,
                ProviderType.CUSTOM_OPENAI_COMPATIBLE,
                "https://gateway.example.com/v1",
                "model-test",
                candidateCredential,
                ApiFormat.OPENAI_CHAT_COMPLETIONS,
                EndpointMode.BASE_URL,
                AuthType.BEARER,
                null
            );

        assertThatThrownBy(() -> verifier.verify(provider))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> {
                UpstreamException typed = (UpstreamException) exception;
                assertThat(typed.code())
                    .isEqualTo("provider_response_rejected");
                assertThat(typed.getMessage())
                    .doesNotContain(candidateCredential);
            });
    }

    @Test
    void verifiesSearchCredentialsThroughTheRegisteredProviderAdapter() {
        SearchProviderRegistry registry = mock(SearchProviderRegistry.class);
        SearchProvider adapter = mock(SearchProvider.class);
        ProviderService.PlainProvider provider =
            new ProviderService.PlainProvider(
                "search-1",
                ProviderKind.SEARCH,
                ProviderType.TAVILY,
                "https://api.tavily.com",
                null,
                "secret",
                null,
                EndpointMode.BASE_URL,
                AuthType.BEARER,
                null
            );
        when(registry.require(ProviderType.TAVILY)).thenReturn(adapter);
        when(adapter.search(eq(provider), any(SearchProvider.SearchQuery.class)))
            .thenReturn(List.of());
        ProviderVerifier verifier = new ProviderVerifier(
            mock(SafeHttpClient.class),
            new ProviderUrlPolicy(true),
            new ObjectMapper(),
            registry
        );

        assertThatCode(() -> verifier.verify(provider)).doesNotThrowAnyException();

        verify(registry).require(ProviderType.TAVILY);
        verify(adapter).search(
            eq(provider),
            org.mockito.ArgumentMatchers.argThat(query ->
                "credential verification".equals(query.query())
                    && query.maxResults() == 1
                    && "any".equals(query.freshness())
            )
        );
    }

    private static ProviderVerifier verifier(SafeHttpClient http) {
        return new ProviderVerifier(
            http,
            new ProviderUrlPolicy(true),
            new ObjectMapper(),
            mock(SearchProviderRegistry.class)
        );
    }

    private static ProviderService.PlainProvider provider(
        ProviderType type,
        String address,
        ApiFormat format,
        EndpointMode endpointMode,
        AuthType authType,
        String authHeader
    ) {
        return new ProviderService.PlainProvider(
            "provider-1",
            ProviderKind.MODEL,
            type,
            address,
            "model-test",
            "secret",
            format,
            endpointMode,
            authType,
            authHeader
        );
    }
}

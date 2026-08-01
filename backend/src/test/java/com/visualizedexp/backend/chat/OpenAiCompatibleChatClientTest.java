package com.visualizedexp.backend.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.provider.ProviderKind;
import com.visualizedexp.backend.provider.ProviderAuthentication;
import com.visualizedexp.backend.provider.ProviderService;
import com.visualizedexp.backend.provider.ProviderType;
import com.visualizedexp.backend.provider.ProviderUrlPolicy;
import com.visualizedexp.backend.provider.SafeHttpClient;
import com.visualizedexp.backend.provider.UpstreamException;
import com.visualizedexp.backend.provider.ApiFormat;
import com.visualizedexp.backend.provider.AuthType;
import com.visualizedexp.backend.provider.EndpointMode;
import com.visualizedexp.backend.search.SearchSource;
import com.visualizedexp.backend.search.WebSearchClient;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OpenAiCompatibleChatClientTest {
    @Test
    void executesBoundedWebSearchToolThenReturnsFinalAnswerAndSources() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ProviderService.PlainProvider modelProvider = new ProviderService.PlainProvider(
            "provider-1",
            ProviderKind.MODEL,
            ProviderType.OPENAI,
            "https://api.openai.com/v1",
            "gpt-test",
            "secret",
            ApiFormat.OPENAI_CHAT_COMPLETIONS,
            EndpointMode.BASE_URL,
            AuthType.BEARER,
            null
        );
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true)))
            .thenReturn(
                new SafeHttpClient.Response(
                    200,
                    """
                    {"choices":[{"message":{
                      "role":"assistant",
                      "content":null,
                      "tool_calls":[{
                        "id":"call_1",
                        "type":"function",
                        "function":{
                          "name":"web_search",
                          "arguments":"{\\"query\\":\\"Spring Boot current release\\",\\"freshness\\":\\"week\\"}"
                        }
                      }]
                    }}]}
                    """
                ),
                new SafeHttpClient.Response(
                    200,
                    """
                    {"choices":[{"message":{
                      "role":"assistant",
                      "content":"已根据最新资料回答 [1]。"
                    }}]}
                    """
                )
            );
        SearchSource source = new SearchSource(
            "Spring Boot",
            "https://spring.io/projects/spring-boot",
            "Official project page",
            null
        );
        when(searchSession.search(
            "Spring Boot current release",
            5,
            "week"
        )).thenReturn(List.of(source));

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );
        SelectionChatModelClient.Completion completion = client.complete(
            "owner-a",
            "现在是什么版本？",
            "Spring Boot",
            List.of(),
            SearchMode.AUTO
        );

        assertThat(completion.text()).isEqualTo("已根据最新资料回答 [1]。");
        assertThat(completion.sources()).containsExactly(source);
        assertThat(completion.search().mode()).isEqualTo(SearchMode.AUTO);
        assertThat(completion.search().status()).isEqualTo(SearchStatus.USED);
        assertThat(completion.search().providerConfigId())
            .isEqualTo("search-provider-1");
        assertThat(completion.search().callCount()).isEqualTo(1);
        verify(searchSession).search(
            "Spring Boot current release",
            5,
            "week"
        );
        verify(http, times(2)).send(any(HttpRequest.Builder.class), eq(true));
    }

    @Test
    void reportsCompletedSearchProgressWhenSecondModelRequestHasKnownFailure() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-snapshot-known"
        );
        SearchSource source = new SearchSource(
            "Known failure evidence",
            "https://example.test/known",
            "Search completed before the model failed.",
            null
        );
        when(searchSession.search("current release", 5, "any"))
            .thenReturn(List.of(source));
        when(http.send(any(HttpRequest.Builder.class), eq(true)))
            .thenReturn(
                new SafeHttpClient.Response(
                    200,
                    """
                    {"choices":[{"message":{"tool_calls":[{
                      "id":"call_known",
                      "type":"function",
                      "function":{
                        "name":"web_search",
                        "arguments":"{\\"query\\":\\"current release\\"}"
                      }
                    }]}}]}
                    """
                ),
                new SafeHttpClient.Response(
                    400,
                    """
                    {"error":{"code":"model_not_found","message":"Unknown model id"}}
                    """
                )
            );
        AtomicReference<List<SearchSource>> recordedSources =
            new AtomicReference<>();
        AtomicReference<SelectionChatModelClient.SearchExecution> recordedSearch =
            new AtomicReference<>();
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Answer with current facts.",
            "Selected sentence.",
            List.of(),
            SearchMode.FORCE,
            (sources, execution) -> {
                recordedSources.set(sources);
                recordedSearch.set(execution);
            }
        ))
            .isInstanceOf(SelectionChatModelClient.CompletionFailure.class)
            .satisfies(exception -> {
                SelectionChatModelClient.CompletionFailure failure =
                    (SelectionChatModelClient.CompletionFailure) exception;
                assertThat(failure.failure())
                    .isInstanceOf(UpstreamException.class);
                assertThat(((UpstreamException) failure.failure()).code())
                    .isEqualTo("provider_verification_failed");
                assertThat(failure.sources()).containsExactly(source);
                assertThat(failure.search().providerConfigId())
                    .isEqualTo("search-snapshot-known");
                assertThat(failure.search().callCount()).isEqualTo(1);
            });
        assertThat(recordedSources.get()).containsExactly(source);
        assertThat(recordedSearch.get().status()).isEqualTo(SearchStatus.USED);
        assertThat(recordedSearch.get().providerConfigId())
            .isEqualTo("search-snapshot-known");
        assertThat(recordedSearch.get().callCount()).isEqualTo(1);
        verify(http, times(2)).send(any(HttpRequest.Builder.class), eq(true));
    }

    @Test
    void reportsCompletedSearchProgressWhenSecondModelRequestIsAmbiguous() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-snapshot-timeout"
        );
        SearchSource source = new SearchSource(
            "Timeout evidence",
            "https://example.test/timeout",
            "Search completed before the response became ambiguous.",
            null
        );
        when(searchSession.search("latest status", 5, "any"))
            .thenReturn(List.of(source));
        when(http.send(any(HttpRequest.Builder.class), eq(true)))
            .thenReturn(new SafeHttpClient.Response(
                200,
                """
                {"choices":[{"message":{"tool_calls":[{
                  "id":"call_timeout",
                  "type":"function",
                  "function":{
                    "name":"web_search",
                    "arguments":"{\\"query\\":\\"latest status\\"}"
                  }
                }]}}]}
                """
            ))
            .thenThrow(new UpstreamException(
                "provider_timeout",
                "Provider response is ambiguous.",
                504,
                true,
                true
            ));
        AtomicReference<SelectionChatModelClient.SearchExecution> recordedSearch =
            new AtomicReference<>();
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Answer with current facts.",
            "Selected sentence.",
            List.of(),
            SearchMode.FORCE,
            (sources, execution) -> recordedSearch.set(execution)
        ))
            .isInstanceOf(SelectionChatModelClient.CompletionFailure.class)
            .satisfies(exception -> {
                SelectionChatModelClient.CompletionFailure failure =
                    (SelectionChatModelClient.CompletionFailure) exception;
                assertThat(failure.failure())
                    .isInstanceOf(UpstreamException.class);
                UpstreamException cause = (UpstreamException) failure.failure();
                assertThat(cause.code()).isEqualTo("provider_timeout");
                assertThat(cause.ambiguous()).isTrue();
                assertThat(failure.sources()).containsExactly(source);
                assertThat(failure.search().providerConfigId())
                    .isEqualTo("search-snapshot-timeout");
                assertThat(failure.search().callCount()).isEqualTo(1);
            });
        assertThat(recordedSearch.get().status()).isEqualTo(SearchStatus.USED);
        assertThat(recordedSearch.get().providerConfigId())
            .isEqualTo("search-snapshot-timeout");
        assertThat(recordedSearch.get().callCount()).isEqualTo(1);
        verify(http, times(2)).send(any(HttpRequest.Builder.class), eq(true));
    }

    @Test
    void keepsSearchOfferedWhenFirstModelRequestFailsBeforeSearchIo() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-offered"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true)))
            .thenThrow(new UpstreamException(
                "provider_unavailable",
                "The first model request failed.",
                502,
                true,
                false
            ));
        AtomicReference<SelectionChatModelClient.SearchExecution> recordedSearch =
            new AtomicReference<>();
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Answer with current facts.",
            "Selected sentence.",
            List.of(),
            SearchMode.AUTO,
            (sources, execution) -> recordedSearch.set(execution)
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_unavailable"));
        assertThat(recordedSearch.get().status())
            .isEqualTo(SearchStatus.OFFERED);
        assertThat(recordedSearch.get().providerConfigId()).isNull();
        assertThat(recordedSearch.get().callCount()).isZero();
        verifyNoInteractions(searchSession);
    }

    @Test
    void keepsSearchUnavailableWhenFirstModelRequestFailsWithoutASession() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        when(search.findActive("owner-a")).thenReturn(Optional.empty());
        when(http.send(any(HttpRequest.Builder.class), eq(true)))
            .thenThrow(new UpstreamException(
                "provider_unavailable",
                "The first model request failed.",
                502,
                true,
                false
            ));
        AtomicReference<SelectionChatModelClient.SearchExecution> recordedSearch =
            new AtomicReference<>();
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Answer with current facts.",
            "Selected sentence.",
            List.of(),
            SearchMode.AUTO,
            (sources, execution) -> recordedSearch.set(execution)
        )).isInstanceOf(UpstreamException.class);
        assertThat(recordedSearch.get().status())
            .isEqualTo(SearchStatus.UNAVAILABLE);
        assertThat(recordedSearch.get().providerConfigId()).isNull();
        assertThat(recordedSearch.get().callCount()).isZero();
        verify(search).findActive("owner-a");
    }

    @Test
    void recordsFailedOnlyAfterThePinnedSearchSessionIsActuallyInvoked() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-io-failure"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true)))
            .thenReturn(new SafeHttpClient.Response(
                200,
                """
                {"choices":[{"message":{"tool_calls":[{
                  "id":"call_search_failure",
                  "type":"function",
                  "function":{
                    "name":"web_search",
                    "arguments":"{\\"query\\":\\"latest status\\"}"
                  }
                }]}}]}
                """
            ));
        when(searchSession.search("latest status", 5, "any"))
            .thenThrow(new UpstreamException(
                "search_provider_unavailable",
                "Search provider is unavailable.",
                502,
                true,
                false
            ));
        List<SelectionChatModelClient.SearchExecution> recorded =
            new ArrayList<>();
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Answer with current facts.",
            "Selected sentence.",
            List.of(),
            SearchMode.FORCE,
            (sources, execution) -> recorded.add(execution)
        ))
            .isInstanceOf(SelectionChatModelClient.CompletionFailure.class)
            .satisfies(exception -> {
                SelectionChatModelClient.CompletionFailure failure =
                    (SelectionChatModelClient.CompletionFailure) exception;
                assertThat(failure.search().status())
                    .isEqualTo(SearchStatus.FAILED);
                assertThat(failure.search().providerConfigId())
                    .isEqualTo("search-io-failure");
                assertThat(failure.search().callCount()).isZero();
                assertThat(failure.sources()).isEmpty();
            });
        assertThat(recorded).extracting(
            SelectionChatModelClient.SearchExecution::status
        ).containsExactly(SearchStatus.OFFERED, SearchStatus.FAILED);
        assertThat(recorded.get(1).providerConfigId())
            .isEqualTo("search-io-failure");
        verify(searchSession).search("latest status", 5, "any");
        verify(http, times(1)).send(any(HttpRequest.Builder.class), eq(true));
    }

    @Test
    void rejectsUnsupportedOrOverBudgetToolCallsBeforeSearchExecution() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenReturn(
            new SafeHttpClient.Response(
                200,
                """
                {"choices":[{"message":{
                  "tool_calls":[
                    {"id":"call_1","type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"one\\"}"}},
                    {"id":"call_2","type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"two\\"}"}},
                    {"id":"call_3","type":"function","function":{"name":"fetch_url","arguments":"{\\"query\\":\\"https://example.test\\"}"}}
                  ]
                }}]}
                """
            )
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "核查最新资料",
            "选中的原句",
            List.of(),
            SearchMode.AUTO
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_response_invalid"));
        verifyNoInteractions(searchSession);
    }

    @Test
    void disablesToolsAndSearchWhenModeIsOff() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<JsonNode> requestBody = new AtomicReference<>();
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenAnswer(
            invocation -> {
                HttpRequest request = ((HttpRequest.Builder) invocation
                    .getArgument(0))
                    .build();
                requestBody.set(objectMapper.readTree(body(request)));
                return new SafeHttpClient.Response(
                    200,
                    """
                    {"choices":[{"message":{"content":"不联网回答。"}}]}
                    """
                );
            }
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            objectMapper
        );
        SelectionChatModelClient.Completion completion = client.complete(
            "owner-a",
            "解释这句话",
            "选中的原句",
            List.of(),
            SearchMode.OFF
        );

        assertThat(requestBody.get().has("tools")).isFalse();
        assertThat(requestBody.get().has("tool_choice")).isFalse();
        assertThat(completion.search().mode()).isEqualTo(SearchMode.OFF);
        assertThat(completion.search().status()).isEqualTo(SearchStatus.DISABLED);
        assertThat(completion.search().providerConfigId()).isNull();
        assertThat(completion.search().callCount()).isZero();
        verifyNoInteractions(search);
    }

    @Test
    void offersToolsInAutoModeButRecordsOfferedWhenModelSkipsSearch() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<JsonNode> requestBody = new AtomicReference<>();
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenAnswer(
            invocation -> {
                HttpRequest request = ((HttpRequest.Builder) invocation
                    .getArgument(0))
                    .build();
                requestBody.set(objectMapper.readTree(body(request)));
                return new SafeHttpClient.Response(
                    200,
                    """
                    {"choices":[{"message":{"content":"无需联网即可回答。"}}]}
                    """
                );
            }
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            objectMapper
        );
        SelectionChatModelClient.Completion completion = client.complete(
            "owner-a",
            "解释这句话",
            "选中的原句",
            List.of(),
            SearchMode.AUTO
        );

        assertThat(requestBody.get().path("tools")).hasSize(1);
        assertThat(requestBody.get().path("tool_choice").asText())
            .isEqualTo("auto");
        assertThat(completion.search().mode()).isEqualTo(SearchMode.AUTO);
        assertThat(completion.search().status()).isEqualTo(SearchStatus.OFFERED);
        assertThat(completion.search().providerConfigId()).isNull();
        assertThat(completion.search().callCount()).isZero();
        verifyNoInteractions(searchSession);
    }

    @Test
    void completesWithoutSearchWhenNoSearchProviderIsActive() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        when(search.findActive("owner-a")).thenReturn(Optional.empty());
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenReturn(
            new SafeHttpClient.Response(
                200,
                """
                {"choices":[{"message":{"content":"当前无法实时核查。"}}]}
                """
            )
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );
        SelectionChatModelClient.Completion completion = client.complete(
            "owner-a",
            "今天发布了什么？",
            "选中的原句",
            List.of(),
            SearchMode.AUTO
        );

        assertThat(completion.text()).isEqualTo("当前无法实时核查。");
        assertThat(completion.sources()).isEmpty();
        assertThat(completion.search().mode()).isEqualTo(SearchMode.AUTO);
        assertThat(completion.search().status())
            .isEqualTo(SearchStatus.UNAVAILABLE);
        assertThat(completion.search().providerConfigId()).isNull();
        assertThat(completion.search().callCount()).isZero();
        verify(search).findActive("owner-a");
        verify(companion, never()).isCredentialConfigured();
        verify(http, times(1)).send(any(HttpRequest.Builder.class), eq(true));
        verify(providers, never()).requireActive("owner-a", ProviderKind.SEARCH);
    }

    @Test
    void rejectsForceModeWhenNoSearchProviderIsActive() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        AtomicReference<SelectionChatModelClient.SearchExecution> searchTrace =
            new AtomicReference<>();
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        when(search.findActive("owner-a")).thenReturn(Optional.empty());

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "核查最新信息",
            "选中的原句",
            List.of(),
            SearchMode.FORCE,
            (sources, execution) -> searchTrace.set(execution)
        ))
            .isInstanceOf(ApiException.class)
            .satisfies(exception -> {
                ApiException typed = (ApiException) exception;
                assertThat(typed.code())
                    .isEqualTo("search_provider_not_configured");
                assertThat(typed.status()).isEqualTo(409);
                assertThat(typed.retryable()).isFalse();
            });
        assertThat(searchTrace.get().status())
            .isEqualTo(SearchStatus.UNAVAILABLE);
        verifyNoInteractions(http);
        verify(search).findActive("owner-a");
    }

    @Test
    void forcesExactOpenAiToolChoiceAndFailsWhenModelSkipsIt()
        throws Exception {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<JsonNode> requestBody = new AtomicReference<>();
        AtomicReference<SelectionChatModelClient.SearchExecution> searchTrace =
            new AtomicReference<>();
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenAnswer(
            invocation -> {
                HttpRequest request = ((HttpRequest.Builder) invocation
                    .getArgument(0))
                    .build();
                requestBody.set(objectMapper.readTree(body(request)));
                return new SafeHttpClient.Response(
                    200,
                    """
                    {"choices":[{"message":{"content":"直接回答。"}}]}
                    """
                );
            }
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            objectMapper
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "必须联网核查",
            "选中的原句",
            List.of(),
            SearchMode.FORCE,
            (sources, execution) -> searchTrace.set(execution)
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> {
                UpstreamException typed = (UpstreamException) exception;
                assertThat(typed.code())
                    .isEqualTo("model_tool_required_but_not_called");
                assertThat(typed.status()).isEqualTo(422);
                assertThat(typed.retryable()).isFalse();
                assertThat(typed.ambiguous()).isFalse();
            });
        assertThat(requestBody.get().path("tool_choice")).isEqualTo(
            objectMapper.readTree(
                """
                {
                  "type": "function",
                  "function": {"name": "web_search"}
                }
                """
            )
        );
        assertThat(searchTrace.get().status()).isEqualTo(SearchStatus.FAILED);
        assertThat(searchTrace.get().providerConfigId()).isNull();
        assertThat(searchTrace.get().callCount()).isZero();
        verify(http, times(1)).send(any(HttpRequest.Builder.class), eq(true));
        verifyNoInteractions(searchSession);
    }

    @Test
    void forcesExactAnthropicToolChoice() throws Exception {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<JsonNode> requestBody = new AtomicReference<>();
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(anthropicProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenAnswer(
            invocation -> {
                HttpRequest request = ((HttpRequest.Builder) invocation
                    .getArgument(0))
                    .build();
                requestBody.set(objectMapper.readTree(body(request)));
                return new SafeHttpClient.Response(
                    200,
                    """
                    {
                      "content": [{"type": "text", "text": "直接回答。"}],
                      "stop_reason": "end_turn"
                    }
                    """
                );
            }
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            objectMapper
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "必须联网核查",
            "选中的原句",
            List.of(),
            SearchMode.FORCE
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("model_tool_required_but_not_called"));
        assertThat(requestBody.get().path("tool_choice")).isEqualTo(
            objectMapper.readTree(
                """
                {"type": "tool", "name": "web_search"}
                """
            )
        );
        verify(http, times(1)).send(any(HttpRequest.Builder.class), eq(true));
        verifyNoInteractions(searchSession);
    }

    @Test
    void mapsToolRequest4xxWithoutRetryingARequestWithoutTools() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<JsonNode> requestBody = new AtomicReference<>();
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenAnswer(
            invocation -> {
                HttpRequest request = ((HttpRequest.Builder) invocation
                    .getArgument(0))
                    .build();
                requestBody.set(objectMapper.readTree(body(request)));
                return new SafeHttpClient.Response(
                    400,
                    """
                    {"error":{"message":"tools are unsupported"}}
                    """
                );
            }
        );

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            objectMapper
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "按需联网核查",
            "选中的原句",
            List.of(),
            SearchMode.AUTO
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> {
                UpstreamException typed = (UpstreamException) exception;
                assertThat(typed.code()).isEqualTo("model_tools_unsupported");
                assertThat(typed.status()).isEqualTo(422);
                assertThat(typed.retryable()).isFalse();
                assertThat(typed.ambiguous()).isFalse();
            });
        assertThat(requestBody.get().path("tools")).hasSize(1);
        assertThat(requestBody.get().path("tool_choice").asText())
            .isEqualTo("auto");
        verify(http, times(1)).send(any(HttpRequest.Builder.class), eq(true));
        verifyNoInteractions(searchSession);
    }

    @Test
    void executesAnthropicToolUseLoopWithNativeMessagesAndAuthentication() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(anthropicProvider()));
        WebSearchClient.SearchSession searchSession = activeSearch(
            search,
            "search-provider-1"
        );
        List<HttpRequest> requests = new ArrayList<>();
        AtomicInteger attempt = new AtomicInteger();
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenAnswer(
            invocation -> {
                requests.add(((HttpRequest.Builder) invocation.getArgument(0)).build());
                if (attempt.getAndIncrement() == 0) {
                    return new SafeHttpClient.Response(
                        200,
                        """
                        {"content":[
                          {"type":"text","text":"我先核查。"},
                          {"type":"tool_use","id":"toolu_1","name":"web_search","input":{
                            "query":"Java current release",
                            "freshness":"week"
                          }}
                        ],"stop_reason":"tool_use"}
                        """
                    );
                }
                return new SafeHttpClient.Response(
                    200,
                    """
                    {"content":[{"type":"text","text":"Anthropic 最终回答 [1]。"}],
                     "stop_reason":"end_turn"}
                    """
                );
            }
        );
        SearchSource source = new SearchSource(
            "Java",
            "https://www.java.com/",
            "Official page",
            null
        );
        when(searchSession.search(
            "Java current release",
            5,
            "week"
        )).thenReturn(List.of(source));

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );
        SelectionChatModelClient.Completion completion = client.complete(
            "owner-a",
            "现在是什么版本？",
            "Java",
            List.of(),
            SearchMode.AUTO
        );

        assertThat(completion.text()).isEqualTo("Anthropic 最终回答 [1]。");
        assertThat(completion.sources()).containsExactly(source);
        assertThat(requests).hasSize(2);
        assertThat(requests).allSatisfy(request -> {
            assertThat(request.uri()).hasToString(
                "https://api.anthropic.com/v1/messages"
            );
            assertThat(request.headers().firstValue("x-api-key"))
                .contains("secret");
            assertThat(request.headers().firstValue("anthropic-version"))
                .contains(ProviderAuthentication.ANTHROPIC_VERSION);
        });
        verify(searchSession).search(
            "Java current release",
            5,
            "week"
        );
    }

    @Test
    void recordsSearchUnavailableBeforeRejectingMissingModelConfiguration() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.empty());
        when(search.findActive("owner-a")).thenReturn(Optional.empty());
        when(companion.isCredentialConfigured()).thenReturn(false);
        AtomicReference<SelectionChatModelClient.SearchExecution> searchTrace =
            new AtomicReference<>();
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Explain this.",
            "Selected sentence.",
            List.of(),
            SearchMode.AUTO,
            (sources, execution) -> searchTrace.set(execution)
        ))
            .isInstanceOf(ApiException.class)
            .satisfies(exception -> assertThat(
                ((ApiException) exception).code()
            ).isEqualTo("provider_not_configured"));
        assertThat(searchTrace.get().status())
            .isEqualTo(SearchStatus.UNAVAILABLE);
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(
            search,
            companion
        );
        order.verify(search).findActive("owner-a");
        order.verify(companion).isCredentialConfigured();
        verifyNoInteractions(http);
    }

    @Test
    void rejectsProviderResponsesThatEchoTheActiveCredential() {
        String activeCredential = "unit-test-provider-secret";
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        ProviderService.PlainProvider modelProvider =
            new ProviderService.PlainProvider(
                "provider-1",
                ProviderKind.MODEL,
                ProviderType.CUSTOM_OPENAI_COMPATIBLE,
                "https://gateway.example.com/v1",
                "model-test",
                activeCredential,
                ApiFormat.OPENAI_CHAT_COMPLETIONS,
                EndpointMode.BASE_URL,
                AuthType.BEARER,
                null
            );
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.of(modelProvider));
        when(http.send(any(HttpRequest.Builder.class), eq(true))).thenReturn(
            new SafeHttpClient.Response(
                200,
                "{\"choices\":[{\"message\":{\"content\":\""
                    + activeCredential
                    + "\"}}]}"
            )
        );
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "解释一下",
            "选中的原句",
            List.of(),
            SearchMode.OFF
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> {
                UpstreamException typed = (UpstreamException) exception;
                assertThat(typed.code())
                    .isEqualTo("provider_response_rejected");
                assertThat(typed.getMessage())
                    .doesNotContain(activeCredential);
            });
        verify(http).send(any(HttpRequest.Builder.class), eq(true));
        verifyNoInteractions(companion, search);
    }

    @Test
    void usesConfiguredLocalCompanionWhenOwnerHasNoModelOverride() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.empty());
        when(search.findActive("owner-a")).thenReturn(Optional.empty());
        when(companion.isCredentialConfigured()).thenReturn(true);
        AtomicReference<String> requestBody = new AtomicReference<>();
        when(companion.sendChat(anyString())).thenAnswer(invocation -> {
            requestBody.set(invocation.getArgument(0));
            return """
                {"choices":[{"message":{"content":"来自本机 DeepSeek。"}}]}
                """;
        });

        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );
        SelectionChatModelClient.Completion completion = client.complete(
            "owner-a",
            "解释一下",
            "选中的原句",
            List.of(),
            SearchMode.AUTO
        );

        assertThat(completion.text()).isEqualTo("来自本机 DeepSeek。");
        assertThat(completion.providerConfigId()).isNull();
        assertThat(requestBody.get()).contains(
            "\"model\":\"deepseek-v4-pro\""
        );
        verifyNoInteractions(http);
        verify(search).findActive("owner-a");
    }

    @Test
    void preservesGenericCompanionRejectionWhenToolsWerePresent() {
        ProviderService providers = mock(ProviderService.class);
        LocalDeepSeekCompanionClient companion = mock(
            LocalDeepSeekCompanionClient.class
        );
        SafeHttpClient http = mock(SafeHttpClient.class);
        WebSearchClient search = mock(WebSearchClient.class);
        when(providers.findActive("owner-a", ProviderKind.MODEL))
            .thenReturn(Optional.empty());
        when(companion.isCredentialConfigured()).thenReturn(true);
        activeSearch(search, "search-provider-1");
        when(companion.sendChat(anyString())).thenThrow(new UpstreamException(
            "provider_invalid_parameters",
            "The configured model id is invalid.",
            400,
            false,
            false
        ));
        OpenAiCompatibleChatClient client = new OpenAiCompatibleChatClient(
            providers,
            new SelectionChatModelResolver(providers, companion),
            companion,
            new ProviderUrlPolicy(true),
            http,
            search,
            new ObjectMapper()
        );

        assertThatThrownBy(() -> client.complete(
            "owner-a",
            "Explain this.",
            "Selected sentence.",
            List.of(),
            SearchMode.AUTO
        ))
            .isInstanceOf(UpstreamException.class)
            .satisfies(exception -> assertThat(
                ((UpstreamException) exception).code()
            ).isEqualTo("provider_invalid_parameters"));
        verifyNoInteractions(http);
    }

    private static WebSearchClient.SearchSession activeSearch(
        WebSearchClient search,
        String providerConfigId
    ) {
        WebSearchClient.SearchSession session = mock(
            WebSearchClient.SearchSession.class
        );
        when(session.providerConfigId()).thenReturn(providerConfigId);
        when(search.findActive("owner-a")).thenReturn(Optional.of(session));
        return session;
    }

    private static String body(HttpRequest request) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        CompletableFuture<String> completed = new CompletableFuture<>();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<>() {
            @Override
            public void onSubscribe(Flow.Subscription subscription) {
                subscription.request(Long.MAX_VALUE);
            }

            @Override
            public void onNext(ByteBuffer item) {
                byte[] chunk = new byte[item.remaining()];
                item.get(chunk);
                output.writeBytes(chunk);
            }

            @Override
            public void onError(Throwable throwable) {
                completed.completeExceptionally(throwable);
            }

            @Override
            public void onComplete() {
                completed.complete(output.toString(StandardCharsets.UTF_8));
            }
        });
        return completed.join();
    }

    private static ProviderService.PlainProvider modelProvider() {
        return new ProviderService.PlainProvider(
            "provider-1",
            ProviderKind.MODEL,
            ProviderType.OPENAI,
            "https://api.openai.com/v1",
            "gpt-test",
            "secret",
            ApiFormat.OPENAI_CHAT_COMPLETIONS,
            EndpointMode.BASE_URL,
            AuthType.BEARER,
            null
        );
    }

    private static ProviderService.PlainProvider anthropicProvider() {
        return new ProviderService.PlainProvider(
            "provider-anthropic",
            ProviderKind.MODEL,
            ProviderType.ANTHROPIC,
            "https://api.anthropic.com",
            "claude-test",
            "secret",
            ApiFormat.ANTHROPIC_MESSAGES,
            EndpointMode.BASE_URL,
            AuthType.X_API_KEY,
            null
        );
    }
}

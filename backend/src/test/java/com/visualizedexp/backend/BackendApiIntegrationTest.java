package com.visualizedexp.backend;

import com.visualizedexp.backend.chat.SelectionChatModelClient;
import com.visualizedexp.backend.chat.SearchMode;
import com.visualizedexp.backend.chat.SearchStatus;
import com.visualizedexp.backend.provider.ProviderVerifier;
import com.visualizedexp.backend.provider.UpstreamException;
import com.visualizedexp.backend.search.SearchSource;
import com.visualizedexp.backend.search.WebSearchClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:backend-api;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "app.crypto.master-key-base64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "app.auth.internal-token=test-internal-token"
})
@AutoConfigureMockMvc
class BackendApiIntegrationTest {
    private static final String AUTHORIZATION = "Bearer test-internal-token";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private org.springframework.context.ApplicationContext applicationContext;

    @MockitoBean
    private SelectionChatModelClient model;

    @MockitoBean
    private WebSearchClient webSearch;

    @MockitoBean
    private ProviderVerifier verifier;

    @Autowired
    private com.visualizedexp.backend.provider.ProviderService providerService;

    @Test
    void healthBypassesOwnerAndInternalTokenButChecksDatabase() throws Exception {
        mvc.perform(get("/api/v1/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));

        mvc.perform(get("/api/v1/sessions")
                .header("X-Owner-Id", "alice@example.test"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("backend_authentication_failed"));
    }

    @Test
    void internalSearchRequiresServerBearerAndOwnerAndIsNotApiRoutable()
        throws Exception {
        String body = """
            {
              "query": "latest release"
            }
            """;

        mvc.perform(post("/internal/v1/search")
                .header("X-Owner-Id", "search-owner@example.test")
                .contentType("application/json")
                .content(body))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("backend_authentication_failed"));

        mvc.perform(post("/internal/v1/search")
                .header("Authorization", AUTHORIZATION)
                .contentType("application/json")
                .content(body))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("authentication_required"));

        var mappings = applicationContext.getBean(
            "requestMappingHandlerMapping",
            org.springframework.web.servlet.mvc.method.annotation
                .RequestMappingHandlerMapping.class
        );
        var paths = mappings.getHandlerMethods().keySet().stream()
            .flatMap(mapping -> mapping.getPatternValues().stream())
            .collect(java.util.stream.Collectors.toSet());
        org.assertj.core.api.Assertions.assertThat(paths)
            .contains("/internal/v1/search")
            .doesNotContain("/api/internal/v1/search");

        org.mockito.Mockito.verifyNoInteractions(webSearch);
    }

    @Test
    void internalSearchUsesOwnerScopedGatewayAndCapsTheResponse()
        throws Exception {
        when(webSearch.search(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.eq("latest release"),
            org.mockito.ArgumentMatchers.eq(5),
            org.mockito.ArgumentMatchers.eq("week")
        )).thenReturn(List.of(
            source(1),
            source(2),
            source(3),
            source(4),
            source(5),
            source(6)
        ));

        mvc.perform(post("/internal/v1/search")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-owner@example.test")
                .contentType("application/json")
                .content("""
                    {
                      "query": "  latest release  ",
                      "maxResults": 5,
                      "freshness": "week"
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sources.length()").value(5))
            .andExpect(jsonPath("$.sources[0].title").value("Source 1"))
            .andExpect(jsonPath("$.sources[0].url").value(
                "https://example.test/source-1"
            ))
            .andExpect(jsonPath("$.sources[4].title").value("Source 5"))
            .andExpect(content().string(not(containsString("apiKey"))))
            .andExpect(content().string(not(containsString("credential"))));

        verify(webSearch).search(
            org.mockito.ArgumentMatchers.argThat(
                owner -> owner.matches("^owner_[A-Za-z0-9_-]{43}$")
            ),
            org.mockito.ArgumentMatchers.eq("latest release"),
            org.mockito.ArgumentMatchers.eq(5),
            org.mockito.ArgumentMatchers.eq("week")
        );
    }

    @Test
    void internalSearchRejectsInvalidBoundsBeforeProviderIo() throws Exception {
        for (String body : List.of(
            "{\"query\":\"   \"}",
            "{\"query\":\"" + "q".repeat(301) + "\"}",
            "{\"query\":\"valid\",\"maxResults\":0}",
            "{\"query\":\"valid\",\"maxResults\":6}",
            "{\"query\":\"valid\",\"freshness\":\"decade\"}"
        )) {
            mvc.perform(post("/internal/v1/search")
                    .header("Authorization", AUTHORIZATION)
                    .header("X-Owner-Id", "search-owner@example.test")
                    .contentType("application/json")
                    .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_error"))
                .andExpect(jsonPath("$.retryable").value(false));
        }

        org.mockito.Mockito.verifyNoInteractions(webSearch);
    }

    @Test
    void internalSearchPreservesTypedProviderFailuresWithoutSecretFields()
        throws Exception {
        when(webSearch.search(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.eq("latest release"),
            org.mockito.ArgumentMatchers.eq(5),
            org.mockito.ArgumentMatchers.eq("any")
        )).thenThrow(new UpstreamException(
            "provider_unavailable",
            "搜索供应商暂时不可用。",
            503,
            true,
            false
        ));

        mvc.perform(post("/internal/v1/search")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-owner@example.test")
                .contentType("application/json")
                .content("{\"query\":\"latest release\"}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.code").value("provider_unavailable"))
            .andExpect(jsonPath("$.retryable").value(true))
            .andExpect(content().string(not(containsString("apiKey"))))
            .andExpect(content().string(not(containsString("token"))))
            .andExpect(content().string(not(containsString("ciphertext"))));
    }

    @Test
    void savesOnlyNewerStrictKnowledgeSessionsAndIsolatesOwners() throws Exception {
        String session = knowledgeSession("knowledge-session-a", 1);
        mvc.perform(put("/api/v1/sessions/knowledge-session-a")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.saved").value(true))
            .andExpect(jsonPath("$.stale").value(false))
            .andExpect(jsonPath("$.sessions[0].id").value("knowledge-session-a"));

        mvc.perform(put("/api/v1/sessions/knowledge-session-a")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.saved").value(false))
            .andExpect(jsonPath("$.stale").value(true));

        mvc.perform(get("/api/v1/sessions/knowledge-session-a")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "bob@example.test"))
            .andExpect(status().isOk())
            .andExpect(content().json("{\"session\":null}"));

        String trimmed = session.trim();
        String invalid = trimmed.substring(0, trimmed.length() - 1) + ",\"extra\":true}";
        mvc.perform(put("/api/v1/sessions/knowledge-session-a")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(invalid))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_knowledge_session"));
    }

    @Test
    void readsActivatesRestoresAndDeletesDurableSessions() throws Exception {
        String owner = "lifecycle@example.test";
        for (String id : List.of("lifecycle-a", "lifecycle-b")) {
            mvc.perform(put("/api/v1/sessions/" + id)
                    .header("Authorization", AUTHORIZATION)
                    .header("X-Owner-Id", owner)
                    .contentType("application/json")
                    .content(knowledgeSession(id, 1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.saved").value(true));
        }

        mvc.perform(post("/api/v1/sessions/lifecycle-a/activate")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner))
            .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/sessions/restore")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.session.id").value("lifecycle-a"));

        mvc.perform(get("/api/v1/sessions/lifecycle-a")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.session.id").value("lifecycle-a"));

        String lifecycleOwnerId = jdbc.queryForObject(
            "SELECT owner_id FROM knowledge_sessions WHERE session_id = ?",
            String.class,
            "lifecycle-a"
        );
        jdbc.update(
            """
            INSERT INTO chat_turns (
                owner_id, turn_id, session_id, client_turn_id, request_hash,
                status, user_text, assistant_text, selected_text, source_node_id,
                provider_config_id, sources_json, error_code, created_at,
                completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, NULL, '[]', NULL, ?, ?, ?)
            """,
            lifecycleOwnerId,
            "00000000-0000-0000-0000-000000000001",
            "lifecycle-a",
            "lifecycle-delete-turn",
            "0".repeat(64),
            "Question",
            "Answer",
            "Selection",
            "root",
            "2026-07-30T00:00:00Z",
            "2026-07-30T00:00:01Z",
            "2026-07-30T00:00:01Z"
        );

        mvc.perform(delete("/api/v1/sessions/lifecycle-a")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner))
            .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/sessions/restore")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.session.id").value("lifecycle-b"));

        Integer deletedTurns = jdbc.queryForObject(
            "SELECT COUNT(*) FROM chat_turns WHERE owner_id = ? AND session_id = ?",
            Integer.class,
            lifecycleOwnerId,
            "lifecycle-a"
        );
        Integer survivingSessions = jdbc.queryForObject(
            "SELECT COUNT(*) FROM knowledge_sessions WHERE owner_id = ? AND session_id = ?",
            Integer.class,
            lifecycleOwnerId,
            "lifecycle-b"
        );
        org.assertj.core.api.Assertions.assertThat(deletedTurns).isZero();
        org.assertj.core.api.Assertions.assertThat(survivingSessions).isEqualTo(1);
    }

    @Test
    void chatTurnIsIdempotentAndDoesNotReplayAmbiguousOrFailedCalls() throws Exception {
        when(model.complete(
            anyString(),
            anyString(),
            anyString(),
            anyList(),
            any(SearchMode.class),
            any(SelectionChatModelClient.SearchProgressRecorder.class)
        ))
            .thenAnswer(invocation -> {
                String question = invocation.getArgument(1);
                if (question.contains("不确定")) {
                    throw new UpstreamException(
                        "provider_timeout",
                        "供应商请求超时。",
                        504,
                        true,
                        true
                    );
                }
                if (question.contains("known-failure")) {
                    throw new UpstreamException(
                        "provider_unavailable",
                        "Provider is temporarily unavailable.",
                        502,
                        true,
                        false
                    );
                }
                return new SelectionChatModelClient.Completion(
                    "这是回答。",
                    "provider-test",
                    List.of(),
                    new SelectionChatModelClient.SearchExecution(
                        SearchMode.AUTO,
                        SearchStatus.UNAVAILABLE,
                        null,
                        0
                    )
                );
            });

        String completed = turnRequest("turn-completed", "这句话是什么意思？");
        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(completed))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("completed"))
            .andExpect(jsonPath("$.assistantText").value("这是回答。"))
            .andExpect(jsonPath("$.sources").isArray());

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(completed))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("completed"));

        String unknown = turnRequest("turn-unknown", "这是一次不确定请求");
        for (int attempt = 0; attempt < 2; attempt++) {
            mvc.perform(post("/api/v1/chat/turns")
                    .header("Authorization", AUTHORIZATION)
                    .header("X-Owner-Id", "alice@example.test")
                    .contentType("application/json")
                    .content(unknown))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("unknown"))
                .andExpect(jsonPath("$.search.status").value("offered"))
                .andExpect(jsonPath("$.assistantText").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.completedAt").value(org.hamcrest.Matchers.nullValue()));
        }

        String failed = turnRequest("turn-failed", "known-failure");
        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(failed))
            .andExpect(status().isBadGateway())
            .andExpect(jsonPath("$.code").value("provider_unavailable"));

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(failed))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("turn_already_failed"));

        java.util.Map<String, Object> failedStatus = jdbc.queryForMap(
            """
            SELECT status, search_status
              FROM chat_turns
             WHERE client_turn_id = ?
            """,
            "turn-failed"
        );
        org.assertj.core.api.Assertions.assertThat(failedStatus)
            .containsEntry("status", "FAILED")
            .containsEntry("search_status", "OFFERED");

        verify(model, times(3))
            .complete(
                anyString(),
                anyString(),
                anyString(),
                anyList(),
                any(SearchMode.class),
                any(SelectionChatModelClient.SearchProgressRecorder.class)
            );

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(turnRequest("turn-completed", "不同请求")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("idempotency_conflict"));

        mvc.perform(get("/api/v1/chat/sessions/knowledge-chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.turns.length()").value(3));

        String clientControlledSearch = completed.trim();
        clientControlledSearch = clientControlledSearch.substring(
            0,
            clientControlledSearch.length() - 1
        ) + ",\"webSearch\":{\"enabled\":true,\"maxResults\":5}}";
        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "alice@example.test")
                .contentType("application/json")
                .content(clientControlledSearch))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_request"));
    }

    @Test
    void stalePendingTurnBecomesNonReplayableDuringHistoryRead() throws Exception {
        when(model.complete(
            anyString(),
            anyString(),
            anyString(),
            anyList(),
            any(SearchMode.class),
            any(SelectionChatModelClient.SearchProgressRecorder.class)
        ))
            .thenReturn(new SelectionChatModelClient.Completion(
                "Initial answer.",
                "provider-test",
                List.of(),
                new SelectionChatModelClient.SearchExecution(
                    SearchMode.AUTO,
                    SearchStatus.UNAVAILABLE,
                    null,
                    0
                )
            ));

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "stale-owner@example.test")
                .contentType("application/json")
                .content(turnRequest("turn-stale", "Create a stale turn.")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("completed"));

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "stale-owner@example.test")
                .contentType("application/json")
                .content(turnRequest("turn-fresh", "Keep this turn pending.")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("completed"));

        jdbc.update(
            """
            UPDATE chat_turns
               SET status = 'PENDING',
                   assistant_text = NULL,
                   completed_at = NULL,
                   search_status = 'OFFERED'
             WHERE client_turn_id IN (?, ?)
            """,
            "turn-stale",
            "turn-fresh"
        );
        jdbc.update(
            "UPDATE chat_turns SET updated_at = '2000-01-01T00:00:00Z' WHERE client_turn_id = ?",
            "turn-stale"
        );

        mvc.perform(get("/api/v1/chat/sessions/knowledge-chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "stale-owner@example.test"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.turns.length()").value(2));

        java.util.Map<String, Object> staleTurn = jdbc.queryForMap(
            """
            SELECT status, error_code, search_status
              FROM chat_turns
             WHERE client_turn_id = ?
            """,
            "turn-stale"
        );
        String freshStatus = jdbc.queryForObject(
            "SELECT status FROM chat_turns WHERE client_turn_id = ?",
            String.class,
            "turn-fresh"
        );
        org.assertj.core.api.Assertions.assertThat(staleTurn.get("status"))
            .isEqualTo("UNKNOWN");
        org.assertj.core.api.Assertions.assertThat(staleTurn.get("error_code"))
            .isEqualTo("turn_recovered_after_restart");
        org.assertj.core.api.Assertions.assertThat(staleTurn.get("search_status"))
            .isEqualTo("OFFERED");
        org.assertj.core.api.Assertions.assertThat(freshStatus).isEqualTo("PENDING");
        verify(model, times(2))
            .complete(
                anyString(),
                anyString(),
                anyString(),
                anyList(),
                any(SearchMode.class),
                any(SelectionChatModelClient.SearchProgressRecorder.class)
            );
    }

    @Test
    void chatPersistsExplicitSearchModeAndObservedExecution() throws Exception {
        SearchSource source = source(91);
        when(model.complete(
            anyString(),
            anyString(),
            anyString(),
            anyList(),
            eq(SearchMode.FORCE),
            any(SelectionChatModelClient.SearchProgressRecorder.class)
        )).thenReturn(new SelectionChatModelClient.Completion(
            "联网回答。",
            null,
            List.of(source),
            new SelectionChatModelClient.SearchExecution(
                SearchMode.FORCE,
                SearchStatus.USED,
                "search-config-1",
                1
            )
        ));

        String request = turnRequest(
            "turn-search-trace",
            "核查最新版本",
            "force"
        );
        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-trace-owner@example.test")
                .contentType("application/json")
                .content(request))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.search.mode").value("force"))
            .andExpect(jsonPath("$.search.status").value("used"))
            .andExpect(jsonPath("$.search.providerConfigId")
                .value("search-config-1"))
            .andExpect(jsonPath("$.search.callCount").value(1))
            .andExpect(jsonPath("$.sources[0].url").value(source.url()))
            .andExpect(jsonPath("$.errorCode").value(nullValue()));

        java.util.Map<String, Object> stored = jdbc.queryForMap(
            """
            SELECT search_mode, search_status, search_provider_config_id,
                   search_call_count
              FROM chat_turns
             WHERE client_turn_id = ?
            """,
            "turn-search-trace"
        );
        org.assertj.core.api.Assertions.assertThat(stored)
            .containsEntry("search_mode", "FORCE")
            .containsEntry("search_status", "USED")
            .containsEntry("search_provider_config_id", "search-config-1")
            .containsEntry("search_call_count", 1);

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-trace-owner@example.test")
                .contentType("application/json")
                .content(turnRequest(
                    "turn-search-trace",
                    "核查最新版本",
                    "off"
                )))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("idempotency_conflict"));

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-trace-owner@example.test")
                .contentType("application/json")
                .content(turnRequest(
                    "turn-search-invalid",
                    "核查最新版本",
                    "sometimes"
                )))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("validation_error"));
    }

    @Test
    void chatPersistsSearchProgressBeforeKnownAndAmbiguousSecondModelFailures()
        throws Exception {
        SearchSource source = source(92);
        when(model.complete(
            anyString(),
            anyString(),
            anyString(),
            anyList(),
            eq(SearchMode.FORCE),
            any(SelectionChatModelClient.SearchProgressRecorder.class)
        )).thenAnswer(invocation -> {
            String question = invocation.getArgument(1);
            SelectionChatModelClient.SearchProgressRecorder recorder =
                invocation.getArgument(5);
            recorder.record(
                List.of(source),
                new SelectionChatModelClient.SearchExecution(
                    SearchMode.FORCE,
                    SearchStatus.USED,
                    "search-snapshot-92",
                    1
                )
            );
            boolean ambiguous = question.contains("ambiguous");
            throw new UpstreamException(
                ambiguous ? "provider_timeout" : "provider_unavailable",
                ambiguous
                    ? "Provider response is ambiguous."
                    : "Provider rejected the second request.",
                ambiguous ? 504 : 502,
                true,
                ambiguous
            );
        });

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-failure-owner@example.test")
                .contentType("application/json")
                .content(turnRequest(
                    "turn-search-known-failure",
                    "known second model failure",
                    "force"
                )))
            .andExpect(status().isBadGateway())
            .andExpect(jsonPath("$.code").value("provider_unavailable"));

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-failure-owner@example.test")
                .contentType("application/json")
                .content(turnRequest(
                    "turn-search-ambiguous-failure",
                    "ambiguous second model failure",
                    "force"
                )))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.status").value("unknown"))
            .andExpect(jsonPath("$.search.status").value("used"))
            .andExpect(jsonPath("$.search.providerConfigId")
                .value("search-snapshot-92"))
            .andExpect(jsonPath("$.search.callCount").value(1))
            .andExpect(jsonPath("$.sources[0].url").value(source.url()));

        List<java.util.Map<String, Object>> stored = jdbc.queryForList(
            """
            SELECT client_turn_id, status, search_status,
                   search_provider_config_id, search_call_count, sources_json
              FROM chat_turns
             WHERE client_turn_id IN (?, ?)
             ORDER BY client_turn_id
            """,
            "turn-search-known-failure",
            "turn-search-ambiguous-failure"
        );
        org.assertj.core.api.Assertions.assertThat(stored).hasSize(2);
        org.assertj.core.api.Assertions.assertThat(stored)
            .extracting(row -> row.get("status"))
            .containsExactly("UNKNOWN", "FAILED");
        org.assertj.core.api.Assertions.assertThat(stored).allSatisfy(row -> {
            org.assertj.core.api.Assertions.assertThat(row)
                .containsEntry("search_status", "USED")
                .containsEntry(
                    "search_provider_config_id",
                    "search-snapshot-92"
                )
                .containsEntry("search_call_count", 1);
            org.assertj.core.api.Assertions.assertThat(
                String.valueOf(row.get("sources_json"))
            ).contains(source.url());
        });
    }

    @Test
    void searchFailureTransitionPreservesAutoOfferedButFailsForceSkip()
        throws Exception {
        when(model.complete(
            anyString(),
            anyString(),
            anyString(),
            anyList(),
            any(SearchMode.class),
            any(SelectionChatModelClient.SearchProgressRecorder.class)
        )).thenAnswer(invocation -> {
            SearchMode mode = invocation.getArgument(4);
            SelectionChatModelClient.SearchProgressRecorder recorder =
                invocation.getArgument(5);
            recorder.record(
                List.of(),
                new SelectionChatModelClient.SearchExecution(
                    mode,
                    mode == SearchMode.FORCE
                        ? SearchStatus.FAILED
                        : SearchStatus.OFFERED,
                    null,
                    0
                )
            );
            if (mode == SearchMode.FORCE) {
                throw new UpstreamException(
                    "model_tool_required_but_not_called",
                    "The model skipped the required search call.",
                    422,
                    false,
                    false
                );
            }
            throw new UpstreamException(
                "provider_unavailable",
                "The first model request failed.",
                502,
                true,
                false
            );
        });

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-matrix-owner@example.test")
                .contentType("application/json")
                .content(turnRequest(
                    "turn-auto-first-model-failure",
                    "auto first model failure",
                    "auto"
                )))
            .andExpect(status().isBadGateway())
            .andExpect(jsonPath("$.code").value("provider_unavailable"));

        mvc.perform(post("/api/v1/chat/turns")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "search-matrix-owner@example.test")
                .contentType("application/json")
                .content(turnRequest(
                    "turn-force-skipped-search",
                    "force skipped required search",
                    "force"
                )))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code")
                .value("model_tool_required_but_not_called"));

        java.util.Map<String, String> statuses = jdbc.query(
            """
            SELECT client_turn_id, search_status
              FROM chat_turns
             WHERE client_turn_id IN (?, ?)
            """,
            resultSet -> {
                java.util.Map<String, String> values = new java.util.HashMap<>();
                while (resultSet.next()) {
                    values.put(
                        resultSet.getString("client_turn_id"),
                        resultSet.getString("search_status")
                    );
                }
                return values;
            },
            "turn-auto-first-model-failure",
            "turn-force-skipped-search"
        );
        org.assertj.core.api.Assertions.assertThat(statuses)
            .containsEntry("turn-auto-first-model-failure", "OFFERED")
            .containsEntry("turn-force-skipped-search", "FAILED");
    }

    @Test
    void providerApiNeverReturnsOrStoresPlaintextCredential() throws Exception {
        String request = """
            {
              "name": "OpenAI",
              "kind": "model",
              "provider": "openai",
              "apiKey": "sk-test-super-secret",
              "defaultModel": "gpt-test"
            }
            """;
        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "provider-owner@example.test")
                .contentType("application/json")
                .content(request))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.provider").value("openai"))
            .andExpect(jsonPath("$.provider.apiFormat").value(
                "openai_chat_completions"
            ))
            .andExpect(jsonPath("$.provider.endpointMode").value("base_url"))
            .andExpect(jsonPath("$.provider.authType").value("bearer"))
            .andExpect(jsonPath("$.provider.authHeader").value(nullValue()))
            .andExpect(jsonPath("$.provider.active").value(true))
            .andExpect(content().string(not(containsString("sk-test-super-secret"))))
            .andExpect(content().string(not(containsString("encryptedApiKey"))));

        String encrypted = jdbc.queryForObject(
            "SELECT encrypted_api_key FROM provider_configs WHERE display_name = ?",
            String.class,
            "OpenAI"
        );
        org.assertj.core.api.Assertions.assertThat(encrypted)
            .startsWith("v1.")
            .doesNotContain("sk-test-super-secret");

        String openAiId = jdbc.queryForObject(
            "SELECT config_id FROM provider_configs WHERE display_name = ?",
            String.class,
            "OpenAI"
        );
        mvc.perform(put("/api/v1/providers/" + openAiId)
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "provider-owner@example.test")
                .contentType("application/json")
                .content("""
                    {
                      "name": "OpenAI Updated",
                      "kind": "model",
                      "provider": "openai",
                      "apiKey": "sk-test-replacement-secret",
                      "defaultModel": "gpt-test-updated",
                      "activate": false
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.provider.name").value("OpenAI Updated"))
            .andExpect(jsonPath("$.provider.active").value(true))
            .andExpect(content().string(not(containsString("sk-test-replacement-secret"))));

        String replacedCiphertext = jdbc.queryForObject(
            "SELECT encrypted_api_key FROM provider_configs WHERE config_id = ?",
            String.class,
            openAiId
        );
        org.assertj.core.api.Assertions.assertThat(replacedCiphertext)
            .startsWith("v1.")
            .isNotEqualTo(encrypted)
            .doesNotContain("sk-test-replacement-secret");

        org.mockito.Mockito.doThrow(new UpstreamException(
            "credential_invalid",
            "Credential rejected.",
            401,
            false,
            false
        )).when(verifier).verify(org.mockito.ArgumentMatchers.argThat(
            candidate -> "rejected-provider-key".equals(candidate.apiKey())
        ));
        mvc.perform(put("/api/v1/providers/" + openAiId)
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "provider-owner@example.test")
                .contentType("application/json")
                .content("""
                    {
                      "name": "Must Not Persist",
                      "kind": "model",
                      "provider": "openai",
                      "apiKey": "rejected-provider-key",
                      "defaultModel": "gpt-rejected",
                      "activate": true
                    }
                    """))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("credential_invalid"));

        java.util.Map<String, Object> preservedProvider = jdbc.queryForMap(
            """
            SELECT display_name, default_model, encrypted_api_key
              FROM provider_configs
             WHERE config_id = ?
            """,
            openAiId
        );
        org.assertj.core.api.Assertions.assertThat(preservedProvider.get("display_name"))
            .isEqualTo("OpenAI Updated");
        org.assertj.core.api.Assertions.assertThat(preservedProvider.get("default_model"))
            .isEqualTo("gpt-test-updated");
        org.assertj.core.api.Assertions.assertThat(
            preservedProvider.get("encrypted_api_key")
        ).isEqualTo(replacedCiphertext);

        mvc.perform(get("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "provider-owner@example.test"))
            .andExpect(status().isOk())
            .andExpect(content().string(not(containsString("sk-test-super-secret"))))
            .andExpect(content().string(not(containsString("apiKey"))));

        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", "provider-owner@example.test")
                .contentType("application/json")
                .content("""
                    {
                      "name": "DeepSeek",
                      "kind": "model",
                      "provider": "deepseek",
                      "apiKey": "second-test-secret",
                      "defaultModel": "deepseek-chat",
                      "activate": true
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.active").value(true));

        String providerOwnerId = jdbc.queryForObject(
            "SELECT owner_id FROM provider_configs WHERE display_name = ?",
            String.class,
            "DeepSeek"
        );
        Integer activeProviders = jdbc.queryForObject(
            """
            SELECT COUNT(*)
              FROM provider_configs
             WHERE owner_id = ?
               AND provider_kind = 'MODEL'
               AND active_slot = 'ACTIVE'
            """,
            Integer.class,
            providerOwnerId
        );
        org.assertj.core.api.Assertions.assertThat(activeProviders).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(
            providerService.requireActive(
                providerOwnerId,
                com.visualizedexp.backend.provider.ProviderKind.MODEL
            ).type()
        ).isEqualTo(com.visualizedexp.backend.provider.ProviderType.DEEPSEEK);
    }

    @Test
    void persistsAnthropicProtocolFieldsAndReturnsFixedSearchProtocolMetadata()
        throws Exception {
        String owner = "protocol-provider-owner@example.test";
        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner)
                .contentType("application/json")
                .content("""
                    {
                      "name": "Anthropic gateway",
                      "kind": "model",
                      "provider": "anthropic",
                      "apiKey": "anthropic-test-secret",
                      "baseUrl": "https://api.anthropic.com/v1/messages",
                      "defaultModel": "claude-test",
                      "apiFormat": "anthropic_messages",
                      "endpointMode": "full_url",
                      "authType": "custom_header",
                      "authHeader": "X-Provider-Token",
                      "activate": true
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.provider").value("anthropic"))
            .andExpect(jsonPath("$.provider.apiFormat").value(
                "anthropic_messages"
            ))
            .andExpect(jsonPath("$.provider.endpointMode").value("full_url"))
            .andExpect(jsonPath("$.provider.authType").value("custom_header"))
            .andExpect(jsonPath("$.provider.authHeader").value(
                "X-Provider-Token"
            ))
            .andExpect(content().string(not(containsString(
                "anthropic-test-secret"
            ))));

        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner)
                .contentType("application/json")
                .content("""
                    {
                      "name": "Tavily",
                      "kind": "search",
                      "provider": "tavily",
                      "apiKey": "tavily-test-secret",
                      "activate": true
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.provider").value("tavily"))
            .andExpect(jsonPath("$.provider.apiFormat").value(nullValue()))
            .andExpect(jsonPath("$.provider.endpointMode").value("base_url"))
            .andExpect(jsonPath("$.provider.authType").value("bearer"))
            .andExpect(jsonPath("$.provider.authHeader").value(nullValue()))
            .andExpect(content().string(not(containsString(
                "tavily-test-secret"
            ))));

        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner)
                .contentType("application/json")
                .content("""
                    {
                      "name": "Brave",
                      "kind": "search",
                      "provider": "brave",
                      "apiKey": "brave-test-secret",
                      "activate": false
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.provider").value("brave"))
            .andExpect(jsonPath("$.provider.apiFormat").value(nullValue()))
            .andExpect(jsonPath("$.provider.endpointMode").value("base_url"))
            .andExpect(jsonPath("$.provider.authType").value("custom_header"))
            .andExpect(jsonPath("$.provider.authHeader").value(
                "X-Subscription-Token"
            ))
            .andExpect(content().string(not(containsString(
                "brave-test-secret"
            ))));

        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner)
                .contentType("application/json")
                .content("""
                    {
                      "name": "Invalid fixed header override",
                      "kind": "model",
                      "provider": "gemini",
                      "apiKey": "model-test-secret",
                      "defaultModel": "gemini-test",
                      "authType": "api_key",
                      "authHeader": "X-Goog-Api-Key"
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("validation_error"))
            .andExpect(content().string(not(containsString(
                "model-test-secret"
            ))));

        java.util.Map<String, Object> stored = jdbc.queryForMap(
            """
            SELECT api_format, endpoint_mode, auth_type, auth_header
              FROM provider_configs
             WHERE display_name = 'Anthropic gateway'
            """
        );
        org.assertj.core.api.Assertions.assertThat(stored.get("api_format"))
            .isEqualTo("ANTHROPIC_MESSAGES");
        org.assertj.core.api.Assertions.assertThat(stored.get("endpoint_mode"))
            .isEqualTo("FULL_URL");
        org.assertj.core.api.Assertions.assertThat(stored.get("auth_type"))
            .isEqualTo("CUSTOM_HEADER");
        org.assertj.core.api.Assertions.assertThat(stored.get("auth_header"))
            .isEqualTo("X-Provider-Token");
    }

    @Test
    void providerApiAcceptsKimiAndGlmPresetIdentifiers() throws Exception {
        String owner = "cn-model-provider-owner@example.test";

        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner)
                .contentType("application/json")
                .content("""
                    {
                      "name": "Kimi",
                      "kind": "model",
                      "provider": "kimi",
                      "apiKey": "kimi-test-secret",
                      "defaultModel": "kimi-k3",
                      "activate": true
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.provider").value("kimi"))
            .andExpect(jsonPath("$.provider.baseUrl").value(
                "https://api.moonshot.cn/v1"
            ))
            .andExpect(jsonPath("$.provider.defaultModel").value("kimi-k3"))
            .andExpect(jsonPath("$.provider.apiFormat").value(
                "openai_chat_completions"
            ))
            .andExpect(content().string(not(containsString(
                "kimi-test-secret"
            ))));

        mvc.perform(post("/api/v1/providers")
                .header("Authorization", AUTHORIZATION)
                .header("X-Owner-Id", owner)
                .contentType("application/json")
                .content("""
                    {
                      "name": "GLM",
                      "kind": "model",
                      "provider": "glm",
                      "apiKey": "glm-test-secret",
                      "defaultModel": "glm-5.2",
                      "activate": true
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider.provider").value("glm"))
            .andExpect(jsonPath("$.provider.baseUrl").value(
                "https://open.bigmodel.cn/api/paas/v4"
            ))
            .andExpect(jsonPath("$.provider.defaultModel").value("glm-5.2"))
            .andExpect(jsonPath("$.provider.apiFormat").value(
                "openai_chat_completions"
            ))
            .andExpect(content().string(not(containsString(
                "glm-test-secret"
            ))));

        String providerOwnerId = jdbc.queryForObject(
            "SELECT owner_id FROM provider_configs WHERE display_name = ?",
            String.class,
            "GLM"
        );
        org.assertj.core.api.Assertions.assertThat(
            providerService.requireActive(
                providerOwnerId,
                com.visualizedexp.backend.provider.ProviderKind.MODEL
            ).type()
        ).isEqualTo(com.visualizedexp.backend.provider.ProviderType.GLM);
    }

    @Test
    void missingActiveProviderIsRejectedForTheOwner() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
            providerService.requireActive(
                "missing-provider-owner@example.test",
                com.visualizedexp.backend.provider.ProviderKind.MODEL
            )
        )
            .isInstanceOf(com.visualizedexp.backend.api.ApiException.class)
            .satisfies(exception -> org.assertj.core.api.Assertions.assertThat(
                ((com.visualizedexp.backend.api.ApiException) exception).code()
            ).isEqualTo("provider_not_configured"));
    }

    private static SearchSource source(int index) {
        return new SearchSource(
            "Source " + index,
            "https://example.test/source-" + index,
            "Bounded result " + index,
            null
        );
    }

    private static String turnRequest(String clientTurnId, String question) {
        return turnRequest(clientTurnId, question, null);
    }

    private static String turnRequest(
        String clientTurnId,
        String question,
        String searchMode
    ) {
        String searchModeField = searchMode == null
            ? ""
            : ",\n  \"searchMode\": \"" + searchMode + "\"";
        return """
            {
              "sessionId": "knowledge-chat",
              "clientTurnId": "%s",
              "question": "%s",
              "selection": {
                "nodeId": "root",
                "text": "被选中的句子",
                "contextToken": null
              }%s
            }
            """.formatted(clientTurnId, question, searchModeField);
    }

    private static String knowledgeSession(String id, int revision) {
        return """
            {
              "protocol": "visual-knowledge-session/1",
              "id": "%s",
              "createdAt": "2026-07-30T00:00:00Z",
              "updatedAt": "2026-07-30T00:00:00Z",
              "revision": %d,
              "document": {
                "protocol": "visual-explanation-document/2",
                "id": "document-a",
                "question": "测试问题",
                "title": "测试标题",
                "thesis": "测试主旨",
                "rootId": "root",
                "nodes": [{
                  "id": "root",
                  "parentId": null,
                  "title": "根节点",
                  "eyebrow": "",
                  "summary": "摘要",
                  "detail": "",
                  "terms": [],
                  "kind": "topic",
                  "view": "grid",
                  "depth": 0,
                  "childIds": [],
                  "expandable": false,
                  "expansionState": "terminal",
                  "emphasis": "primary",
                  "confidence": "high",
                  "sourceStatus": "model_knowledge",
                  "evidence": []
                }],
                "relations": [],
                "version": 1
              },
              "navigation": {"entries": ["root"], "cursor": 0},
              "termResults": [],
              "termCards": {},
              "visibleTermCardKeys": [],
              "deepResults": [],
              "activeDeepKey": null,
              "prefetchProfile": "on_demand",
              "usageReceipts": []
            }
            """.formatted(id, revision);
    }
}

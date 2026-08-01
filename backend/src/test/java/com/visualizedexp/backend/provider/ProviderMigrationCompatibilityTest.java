package com.visualizedexp.backend.provider;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.DriverManager;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ProviderMigrationCompatibilityTest {
    @Test
    void upgradesPopulatedV1RowsWithoutChangingCiphertextOrLegacyMeaning()
        throws Exception {
        String url = "jdbc:h2:mem:provider-migration-"
            + UUID.randomUUID()
            + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
        Flyway.configure()
            .dataSource(url, "sa", "")
            .locations("classpath:db/migration")
            .target(MigrationVersion.fromVersion("1"))
            .load()
            .migrate();

        String ciphertext = "v1.legacy-ciphertext-must-remain-byte-identical";
        try (var connection = DriverManager.getConnection(url, "sa", "");
             var statement = connection.prepareStatement(
                 """
                 INSERT INTO provider_configs (
                     owner_id, config_id, display_name, provider_kind, provider_type,
                     base_url, default_model, encrypted_api_key, active, active_slot,
                     last_verified_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 """
             )) {
            statement.setString(1, "owner-a");
            statement.setString(2, "11111111-1111-1111-1111-111111111111");
            statement.setString(3, "Legacy OpenAI");
            statement.setString(4, "MODEL");
            statement.setString(5, "OPENAI");
            statement.setString(6, "https://api.openai.com/v1");
            statement.setString(7, "gpt-test");
            statement.setString(8, ciphertext);
            statement.setBoolean(9, true);
            statement.setString(10, "ACTIVE");
            statement.setString(11, "2026-07-30T00:00:00Z");
            statement.setString(12, "2026-07-30T00:00:00Z");
            statement.setString(13, "2026-07-30T00:00:00Z");
            statement.executeUpdate();
        }

        Flyway.configure()
            .dataSource(url, "sa", "")
            .locations("classpath:db/migration")
            .load()
            .migrate();

        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "sa", ""));
        ProviderConfigRepository.StoredProvider provider =
            new ProviderConfigRepository(jdbc)
                .find("owner-a", "11111111-1111-1111-1111-111111111111")
                .orElseThrow();

        assertThat(provider.encryptedApiKey()).isEqualTo(ciphertext);
        assertThat(provider.apiFormat()).isEqualTo(
            ApiFormat.OPENAI_CHAT_COMPLETIONS
        );
        assertThat(provider.endpointMode()).isEqualTo(EndpointMode.BASE_URL);
        assertThat(provider.authType()).isEqualTo(AuthType.BEARER);
        assertThat(provider.authHeader()).isNull();
    }

    @Test
    void upgradesPopulatedV2ChatTurnsWithExplicitLegacySearchTrace() {
        String url = "jdbc:h2:mem:chat-search-migration-"
            + UUID.randomUUID()
            + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
        Flyway.configure()
            .dataSource(url, "sa", "")
            .locations("classpath:db/migration")
            .target(MigrationVersion.fromVersion("2"))
            .load()
            .migrate();

        JdbcTemplate jdbc = new JdbcTemplate(
            new DriverManagerDataSource(url, "sa", "")
        );
        String sources = """
            [{"title":"Existing","url":"https://example.test/source",
              "snippet":"Preserved","publishedAt":null}]
            """.replaceAll("\\s+", "");
        jdbc.update(
            """
            INSERT INTO chat_turns (
                owner_id, turn_id, session_id, client_turn_id, request_hash,
                status, user_text, assistant_text, selected_text, source_node_id,
                provider_config_id, sources_json, error_code, created_at,
                completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
            """,
            "owner-a",
            "22222222-2222-2222-2222-222222222222",
            "session-a",
            "client-a",
            "a".repeat(64),
            "COMPLETED",
            "Question",
            "Answer",
            "Selection",
            "root",
            null,
            sources,
            "2026-07-30T00:00:00Z",
            "2026-07-30T00:00:01Z",
            "2026-07-30T00:00:01Z"
        );

        Flyway.configure()
            .dataSource(url, "sa", "")
            .locations("classpath:db/migration")
            .load()
            .migrate();

        java.util.Map<String, Object> row = jdbc.queryForMap(
            """
            SELECT sources_json, search_mode, search_status,
                   search_provider_config_id, search_call_count
              FROM chat_turns
             WHERE owner_id = 'owner-a' AND client_turn_id = 'client-a'
            """
        );
        assertThat(row)
            .containsEntry("sources_json", sources)
            .containsEntry("search_mode", "AUTO")
            .containsEntry("search_status", "LEGACY_UNKNOWN")
            .containsEntry("search_provider_config_id", null)
            .containsEntry("search_call_count", 0);
    }
}

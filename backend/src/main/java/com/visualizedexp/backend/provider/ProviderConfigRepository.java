package com.visualizedexp.backend.provider;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public class ProviderConfigRepository {
    private final JdbcTemplate jdbc;

    public ProviderConfigRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String ownerId, StoredProvider provider) {
        jdbc.update(
            """
            INSERT INTO provider_configs (
                owner_id, config_id, display_name, provider_kind, provider_type,
                base_url, default_model, encrypted_api_key, active,
                active_slot, last_verified_at, created_at, updated_at,
                api_format, endpoint_mode, auth_type, auth_header
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, NULL, ?, ?, ?, ?, ?, ?, ?)
            """,
            ownerId,
            provider.id(),
            provider.name(),
            provider.kind().name(),
            provider.type().name(),
            provider.baseUrl(),
            provider.defaultModel(),
            provider.encryptedApiKey(),
            provider.lastVerifiedAt(),
            provider.createdAt(),
            provider.updatedAt(),
            provider.apiFormat() == null ? null : provider.apiFormat().name(),
            provider.endpointMode().name(),
            provider.authType().name(),
            provider.authHeader()
        );
    }

    @Transactional
    public void insertAndMaybeActivate(
        String ownerId,
        StoredProvider provider,
        boolean activate
    ) {
        insert(ownerId, provider);
        if (activate) {
            activate(ownerId, provider.kind(), provider.id());
        }
    }

    public int update(String ownerId, StoredProvider provider) {
        return jdbc.update(
            """
            UPDATE provider_configs
               SET display_name = ?,
                   provider_type = ?,
                   base_url = ?,
                   default_model = ?,
                   encrypted_api_key = ?,
                   last_verified_at = ?,
                   updated_at = ?,
                   api_format = ?,
                   endpoint_mode = ?,
                   auth_type = ?,
                   auth_header = ?
             WHERE owner_id = ? AND config_id = ? AND provider_kind = ?
            """,
            provider.name(),
            provider.type().name(),
            provider.baseUrl(),
            provider.defaultModel(),
            provider.encryptedApiKey(),
            provider.lastVerifiedAt(),
            provider.updatedAt(),
            provider.apiFormat() == null ? null : provider.apiFormat().name(),
            provider.endpointMode().name(),
            provider.authType().name(),
            provider.authHeader(),
            ownerId,
            provider.id(),
            provider.kind().name()
        );
    }

    @Transactional
    public int updateAndMaybeActivate(
        String ownerId,
        StoredProvider provider,
        boolean activate
    ) {
        int changed = update(ownerId, provider);
        if (changed == 1 && activate) {
            activate(ownerId, provider.kind(), provider.id());
        }
        return changed;
    }

    public Optional<StoredProvider> find(String ownerId, String configId) {
        List<StoredProvider> rows = jdbc.query(
            """
            SELECT config_id, display_name, provider_kind, provider_type, base_url,
                   default_model, encrypted_api_key, active, last_verified_at,
                   created_at, updated_at, api_format, endpoint_mode,
                   auth_type, auth_header
              FROM provider_configs
             WHERE owner_id = ? AND config_id = ?
            """,
            (resultSet, rowNumber) -> map(resultSet),
            ownerId,
            configId
        );
        return rows.stream().findFirst();
    }

    public Optional<StoredProvider> active(String ownerId, ProviderKind kind) {
        List<StoredProvider> rows = jdbc.query(
            """
            SELECT config_id, display_name, provider_kind, provider_type, base_url,
                   default_model, encrypted_api_key, active, last_verified_at,
                   created_at, updated_at, api_format, endpoint_mode,
                   auth_type, auth_header
             FROM provider_configs
             WHERE owner_id = ? AND provider_kind = ? AND active_slot = 'ACTIVE'
             ORDER BY updated_at DESC
             LIMIT 1
            """,
            (resultSet, rowNumber) -> map(resultSet),
            ownerId,
            kind.name()
        );
        return rows.stream().findFirst();
    }

    public List<StoredProvider> list(String ownerId) {
        return jdbc.query(
            """
            SELECT config_id, display_name, provider_kind, provider_type, base_url,
                   default_model, encrypted_api_key, active, last_verified_at,
                   created_at, updated_at, api_format, endpoint_mode,
                   auth_type, auth_header
              FROM provider_configs
             WHERE owner_id = ?
             ORDER BY provider_kind, updated_at DESC, config_id
            """,
            (resultSet, rowNumber) -> map(resultSet),
            ownerId
        );
    }

    @Transactional
    public void activate(String ownerId, ProviderKind kind, String configId) {
        jdbc.update(
            """
            UPDATE provider_configs
               SET active = FALSE, active_slot = NULL
             WHERE owner_id = ? AND provider_kind = ? AND active_slot = 'ACTIVE'
            """,
            ownerId,
            kind.name()
        );
        int changed = jdbc.update(
            """
            UPDATE provider_configs
               SET active = TRUE, active_slot = 'ACTIVE'
             WHERE owner_id = ? AND provider_kind = ? AND config_id = ?
            """,
            ownerId,
            kind.name(),
            configId
        );
        if (changed != 1) {
            throw new IllegalStateException("Cannot activate a missing provider config");
        }
    }

    public void delete(String ownerId, String configId) {
        jdbc.update(
            "DELETE FROM provider_configs WHERE owner_id = ? AND config_id = ?",
            ownerId,
            configId
        );
    }

    private static StoredProvider map(java.sql.ResultSet resultSet)
        throws java.sql.SQLException {
        return new StoredProvider(
            resultSet.getString("config_id"),
            resultSet.getString("display_name"),
            ProviderKind.valueOf(resultSet.getString("provider_kind")),
            ProviderType.valueOf(resultSet.getString("provider_type")),
            resultSet.getString("base_url"),
            resultSet.getString("default_model"),
            resultSet.getString("encrypted_api_key"),
            resultSet.getBoolean("active"),
            resultSet.getString("last_verified_at"),
            resultSet.getString("created_at"),
            resultSet.getString("updated_at"),
            nullableApiFormat(resultSet.getString("api_format")),
            EndpointMode.valueOf(resultSet.getString("endpoint_mode")),
            AuthType.valueOf(resultSet.getString("auth_type")),
            resultSet.getString("auth_header")
        );
    }

    private static ApiFormat nullableApiFormat(String value) {
        return value == null ? null : ApiFormat.valueOf(value);
    }

    public record StoredProvider(
        String id,
        String name,
        ProviderKind kind,
        ProviderType type,
        String baseUrl,
        String defaultModel,
        String encryptedApiKey,
        boolean active,
        String lastVerifiedAt,
        String createdAt,
        String updatedAt,
        ApiFormat apiFormat,
        EndpointMode endpointMode,
        AuthType authType,
        String authHeader
    ) {
    }
}

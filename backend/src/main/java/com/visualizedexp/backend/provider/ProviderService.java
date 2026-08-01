package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;
import com.visualizedexp.backend.common.InputRules;
import com.visualizedexp.backend.crypto.SecretCipher;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class ProviderService {
    private static final Pattern MODEL_NAME = Pattern.compile("^[A-Za-z0-9._:/-]{1,160}$");
    private static final Pattern HEADER_NAME = Pattern.compile(
        "^[A-Za-z][A-Za-z0-9-]{0,79}$"
    );
    private static final Set<String> FORBIDDEN_AUTH_HEADERS = Set.of(
        "accept",
        "anthropic-version",
        "connection",
        "content-length",
        "content-type",
        "cookie",
        "expect",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "set-cookie",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade"
    );

    private final ProviderConfigRepository repository;
    private final ProviderUrlPolicy urlPolicy;
    private final ProviderVerifier verifier;
    private final SecretCipher cipher;

    public ProviderService(
        ProviderConfigRepository repository,
        ProviderUrlPolicy urlPolicy,
        ProviderVerifier verifier,
        SecretCipher cipher
    ) {
        this.repository = repository;
        this.urlPolicy = urlPolicy;
        this.verifier = verifier;
        this.cipher = cipher;
    }

    public ProviderDtos.ListResponse list(String ownerId) {
        return new ProviderDtos.ListResponse(
            repository.list(ownerId).stream().map(this::summary).toList()
        );
    }

    public ProviderDtos.Summary create(String ownerId, ProviderDtos.WriteRequest request) {
        ProviderKind kind = ProviderKind.parse(request.kind());
        ProviderType type = ProviderType.parse(request.provider());
        requireKind(type, kind);
        String id = UUID.randomUUID().toString();
        String name = InputRules.boundedText(request.name(), 120, "name");
        String apiKey = apiKey(request.apiKey());
        String model = model(kind, request.defaultModel());
        ProtocolConfiguration protocol = protocol(type, kind, request);
        String baseUrl = urlPolicy.resolve(
            type,
            request.baseUrl(),
            protocol.endpointMode(),
            protocol.apiFormat()
        );
        PlainProvider candidate = new PlainProvider(
            id,
            kind,
            type,
            baseUrl,
            model,
            apiKey,
            protocol.apiFormat(),
            protocol.endpointMode(),
            protocol.authType(),
            protocol.authHeader()
        );
        verifier.verify(candidate);

        String now = Instant.now().toString();
        ProviderConfigRepository.StoredProvider stored = new ProviderConfigRepository.StoredProvider(
            id,
            name,
            kind,
            type,
            baseUrl,
            model,
            cipher.encrypt(apiKey, aad(ownerId, id, type)),
            false,
            now,
            now,
            now,
            protocol.apiFormat(),
            protocol.endpointMode(),
            protocol.authType(),
            protocol.authHeader()
        );
        repository.insertAndMaybeActivate(
            ownerId,
            stored,
            !Boolean.FALSE.equals(request.activate())
        );
        return summary(repository.find(ownerId, id).orElseThrow());
    }

    public ProviderDtos.Summary update(
        String ownerId,
        String configId,
        ProviderDtos.WriteRequest request
    ) {
        requireConfigId(configId);
        ProviderConfigRepository.StoredProvider existing = require(ownerId, configId);
        ProviderKind kind = ProviderKind.parse(request.kind());
        if (kind != existing.kind()) {
            throw new ApiException(
                "provider_kind_immutable",
                "不能改变已保存配置的 kind。",
                409,
                false
            );
        }
        ProviderType type = ProviderType.parse(request.provider());
        requireKind(type, kind);
        String plaintext = request.apiKey() == null || request.apiKey().isBlank()
            ? cipher.decrypt(
                existing.encryptedApiKey(),
                aad(ownerId, existing.id(), existing.type())
            )
            : apiKey(request.apiKey());
        String model = model(kind, request.defaultModel());
        ProtocolConfiguration protocol = protocol(type, kind, request);
        String baseUrl = urlPolicy.resolve(
            type,
            request.baseUrl(),
            protocol.endpointMode(),
            protocol.apiFormat()
        );
        PlainProvider candidate = new PlainProvider(
            configId,
            kind,
            type,
            baseUrl,
            model,
            plaintext,
            protocol.apiFormat(),
            protocol.endpointMode(),
            protocol.authType(),
            protocol.authHeader()
        );
        verifier.verify(candidate);

        String now = Instant.now().toString();
        ProviderConfigRepository.StoredProvider replacement =
            new ProviderConfigRepository.StoredProvider(
                configId,
                InputRules.boundedText(request.name(), 120, "name"),
                kind,
                type,
                baseUrl,
                model,
                cipher.encrypt(plaintext, aad(ownerId, configId, type)),
                existing.active(),
                now,
                existing.createdAt(),
                now,
                protocol.apiFormat(),
                protocol.endpointMode(),
                protocol.authType(),
                protocol.authHeader()
            );
        if (repository.updateAndMaybeActivate(
            ownerId,
            replacement,
            Boolean.TRUE.equals(request.activate())
        ) != 1) {
            throw notFound();
        }
        return summary(repository.find(ownerId, configId).orElseThrow());
    }

    public ProviderDtos.Summary activate(String ownerId, String configId) {
        requireConfigId(configId);
        ProviderConfigRepository.StoredProvider provider = require(ownerId, configId);
        repository.activate(ownerId, provider.kind(), configId);
        return summary(repository.find(ownerId, configId).orElseThrow());
    }

    public void delete(String ownerId, String configId) {
        requireConfigId(configId);
        repository.delete(ownerId, configId);
    }

    public PlainProvider requireActive(String ownerId, ProviderKind kind) {
        return findActive(ownerId, kind)
            .orElseThrow(() -> new ApiException(
                "provider_not_configured",
                kind == ProviderKind.MODEL
                    ? "请先配置并启用一个 AI 模型供应商。"
                    : "请先配置并启用一个搜索供应商。",
                409,
                false
            ));
    }

    public Optional<PlainProvider> findActive(String ownerId, ProviderKind kind) {
        return repository.active(ownerId, kind).map(provider -> {
            ApiFormat apiFormat = provider.apiFormat() == null
                ? provider.type().defaultApiFormat()
                : provider.apiFormat();
            String baseUrl = urlPolicy.resolve(
                provider.type(),
                provider.baseUrl(),
                provider.endpointMode(),
                apiFormat
            );
            String apiKey = cipher.decrypt(
                provider.encryptedApiKey(),
                aad(ownerId, provider.id(), provider.type())
            );
            return new PlainProvider(
                provider.id(),
                provider.kind(),
                provider.type(),
                baseUrl,
                provider.defaultModel(),
                apiKey,
                apiFormat,
                provider.endpointMode(),
                provider.authType(),
                provider.authHeader()
            );
        });
    }

    public boolean hasActive(String ownerId, ProviderKind kind) {
        return repository.active(ownerId, kind).isPresent();
    }

    private ProviderDtos.Summary summary(ProviderConfigRepository.StoredProvider provider) {
        return new ProviderDtos.Summary(
            provider.id(),
            provider.name(),
            provider.kind().wireName(),
            provider.type().wireName(),
            provider.baseUrl(),
            provider.defaultModel(),
            provider.kind() == ProviderKind.SEARCH || provider.apiFormat() == null
                ? null
                : provider.apiFormat().wireName(),
            provider.endpointMode().wireName(),
            provider.authType().wireName(),
            provider.authHeader(),
            true,
            provider.active(),
            provider.lastVerifiedAt(),
            provider.createdAt(),
            provider.updatedAt()
        );
    }

    private static void requireKind(ProviderType type, ProviderKind kind) {
        if (type.kind() != kind) {
            throw new ApiException(
                "validation_error",
                "kind 与 provider 不匹配。",
                400,
                false
            );
        }
    }

    private static String apiKey(String value) {
        if (value == null || value.isBlank() || value.length() > 4096) {
            throw new ApiException("validation_error", "apiKey 格式无效。", 400, false);
        }
        return value.trim();
    }

    private static String model(ProviderKind kind, String value) {
        if (kind == ProviderKind.SEARCH) {
            if (value != null && !value.isBlank()) {
                throw new ApiException(
                    "validation_error",
                    "搜索供应商不接受 defaultModel。",
                    400,
                    false
                );
            }
            return null;
        }
        if (value == null || !MODEL_NAME.matcher(value).matches()) {
            throw new ApiException(
                "validation_error",
                "defaultModel 格式无效。",
                400,
                false
            );
        }
        return value;
    }

    private static ProtocolConfiguration protocol(
        ProviderType type,
        ProviderKind kind,
        ProviderDtos.WriteRequest request
    ) {
        EndpointMode endpointMode = request.endpointMode() == null
            || request.endpointMode().isBlank()
            ? EndpointMode.BASE_URL
            : EndpointMode.parse(request.endpointMode());
        AuthType authType = request.authType() == null
            || request.authType().isBlank()
            ? type.defaultAuthType()
            : AuthType.parse(request.authType());
        String authHeader = authHeader(authType, request.authHeader(), type);

        if (kind == ProviderKind.SEARCH) {
            if (request.apiFormat() != null && !request.apiFormat().isBlank()) {
                throw new ApiException(
                    "validation_error",
                    "搜索供应商不接受 apiFormat。",
                    400,
                    false
                );
            }
            if (endpointMode != EndpointMode.BASE_URL
                || authType != type.defaultAuthType()
                || !java.util.Objects.equals(authHeader, type.defaultAuthHeader())) {
                throw new ApiException(
                    "validation_error",
                    "搜索供应商的端点与鉴权方式由服务端固定。",
                    400,
                    false
                );
            }
            return new ProtocolConfiguration(
                null,
                EndpointMode.BASE_URL,
                type.defaultAuthType(),
                type.defaultAuthHeader()
            );
        }

        ApiFormat apiFormat = request.apiFormat() == null
            || request.apiFormat().isBlank()
            ? type.defaultApiFormat()
            : ApiFormat.parse(request.apiFormat());
        return new ProtocolConfiguration(
            apiFormat,
            endpointMode,
            authType,
            authHeader
        );
    }

    private static String authHeader(
        AuthType authType,
        String requested,
        ProviderType type
    ) {
        if (authType != AuthType.CUSTOM_HEADER) {
            if (requested != null && !requested.isBlank()) {
                throw new ApiException(
                    "validation_error",
                    "仅 custom_header 鉴权允许设置 authHeader。",
                    400,
                    false
                );
            }
            return null;
        }
        String defaultHeader = type.defaultAuthHeader();
        String candidate = requested == null || requested.isBlank()
            ? defaultHeader
            : requested.trim();
        if (candidate == null
            || !HEADER_NAME.matcher(candidate).matches()
            || FORBIDDEN_AUTH_HEADERS.contains(candidate.toLowerCase(Locale.ROOT))) {
            throw new ApiException(
                "validation_error",
                "authHeader 格式无效或不允许覆盖受保护请求头。",
                400,
                false
            );
        }
        return candidate;
    }

    private static void requireConfigId(String value) {
        try {
            UUID.fromString(value);
        } catch (RuntimeException exception) {
            throw new ApiException(
                "validation_error",
                "provider config id 格式无效。",
                400,
                false
            );
        }
    }

    private ProviderConfigRepository.StoredProvider require(String ownerId, String configId) {
        return repository.find(ownerId, configId).orElseThrow(ProviderService::notFound);
    }

    private static ApiException notFound() {
        return new ApiException(
            "provider_config_not_found",
            "供应商配置不存在。",
            404,
            false
        );
    }

    private static String aad(String ownerId, String id, ProviderType type) {
        return ownerId + "|" + id + "|" + type.name();
    }

    public record PlainProvider(
        String id,
        ProviderKind kind,
        ProviderType type,
        String baseUrl,
        String defaultModel,
        String apiKey,
        ApiFormat apiFormat,
        EndpointMode endpointMode,
        AuthType authType,
        String authHeader
    ) {
        @Override
        public String toString() {
            return "PlainProvider[id=" + id + ",kind=" + kind + ",type=" + type + "]";
        }
    }

    private record ProtocolConfiguration(
        ApiFormat apiFormat,
        EndpointMode endpointMode,
        AuthType authType,
        String authHeader
    ) {
    }
}

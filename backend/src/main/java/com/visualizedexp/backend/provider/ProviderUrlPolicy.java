package com.visualizedexp.backend.provider;

import com.visualizedexp.backend.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public final class ProviderUrlPolicy {
    private static final Set<String> FIXED_PATHS = Set.of("/search");
    private static final Set<String> OFFICIAL_PROVIDER_HOSTS = Arrays.stream(
            ProviderType.values()
        )
        .map(ProviderType::defaultBaseUrl)
        .filter(value -> value != null)
        .map(URI::create)
        .map(URI::getHost)
        .filter(value -> value != null)
        .map(value -> value.toLowerCase(Locale.ROOT))
        .collect(Collectors.toUnmodifiableSet());

    private final boolean allowPrivateAddresses;

    public ProviderUrlPolicy(
        @Value("${app.providers.allow-private-addresses:false}") boolean allowPrivateAddresses
    ) {
        this.allowPrivateAddresses = allowPrivateAddresses;
    }

    public String resolve(ProviderType type, String candidate) {
        return resolve(
            type,
            candidate,
            EndpointMode.BASE_URL,
            type.defaultApiFormat()
        );
    }

    public String resolve(
        ProviderType type,
        String candidate,
        EndpointMode endpointMode,
        ApiFormat apiFormat
    ) {
        if (type.kind() == ProviderKind.SEARCH) {
            if (endpointMode != EndpointMode.BASE_URL) {
                throw unsafe("搜索供应商不允许切换 endpointMode。");
            }
            if (candidate != null
                && !candidate.isBlank()
                && !normalize(candidate).equals(type.defaultBaseUrl())) {
                throw unsafe("预设供应商不允许覆盖 baseUrl。");
            }
            return type.defaultBaseUrl();
        }

        if (apiFormat == null) {
            throw unsafe("模型供应商必须提供 apiFormat。");
        }
        String selected = candidate == null || candidate.isBlank()
            ? type.defaultBaseUrl()
            : candidate;
        if (selected == null || selected.isBlank()) {
            throw unsafe("自定义供应商必须提供 baseUrl。");
        }
        String normalized = normalize(selected);
        if (endpointMode == EndpointMode.FULL_URL
            && (candidate == null || candidate.isBlank())) {
            normalized = modelEndpoint(
                normalized,
                EndpointMode.BASE_URL,
                apiFormat
            ).toString();
        }
        validatePublicAddress(normalized);
        return normalized;
    }

    private void validatePublicAddress(String normalized) {
        URI uri;
        try {
            uri = URI.create(normalized);
        } catch (IllegalArgumentException exception) {
            throw unsafe("baseUrl 不是有效 URL。");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())
            && !(allowPrivateAddresses && "http".equalsIgnoreCase(uri.getScheme()))) {
            throw unsafe("自定义供应商默认只允许 HTTPS。");
        }
        if (uri.getHost() == null
            || uri.getUserInfo() != null
            || uri.getFragment() != null
            || uri.getQuery() != null) {
            throw unsafe("baseUrl 不得包含凭据、查询参数或 fragment。");
        }
        if (!allowPrivateAddresses) {
            rejectPrivateHost(uri.getHost());
        }
    }

    public URI endpoint(String baseUrl, String path) {
        if (!FIXED_PATHS.contains(path)) {
            throw new IllegalArgumentException("Provider endpoint path is not allowlisted");
        }
        return URI.create(normalize(baseUrl) + path);
    }

    public URI modelEndpoint(
        String address,
        EndpointMode endpointMode,
        ApiFormat apiFormat
    ) {
        if (endpointMode == EndpointMode.FULL_URL) {
            return URI.create(normalize(address));
        }
        String normalized = normalize(address);
        String path;
        if (apiFormat == ApiFormat.ANTHROPIC_MESSAGES) {
            path = normalized.endsWith("/v1") ? "/messages" : "/v1/messages";
        } else {
            path = "/chat/completions";
        }
        return URI.create(normalized + path);
    }

    public void assertRuntimeSafe(ProviderType type, String baseUrl) {
        resolve(type, baseUrl);
    }

    public void assertRuntimeSafe(
        ProviderType type,
        String address,
        EndpointMode endpointMode,
        ApiFormat apiFormat
    ) {
        resolve(type, address, endpointMode, apiFormat);
    }

    InetAddress[] resolveConnectionAddresses(String host) throws UnknownHostException {
        InetAddress[] addresses = InetAddress.getAllByName(host);
        assertResolvedAddressesSafe(host, addresses);
        return addresses;
    }

    void assertResolvedAddressesSafe(String host, InetAddress[] addresses)
        throws UnknownHostException {
        if (!allowPrivateAddresses) {
            boolean officialHost = OFFICIAL_PROVIDER_HOSTS.contains(
                host.toLowerCase(Locale.ROOT)
            );
            for (InetAddress address : addresses) {
                if (isPrivate(address)
                    && !(officialHost && isBenchmarkFakeAddress(address))) {
                    throw new UnknownHostException(
                        "Provider hostname resolved to a non-public address"
                    );
                }
            }
        }
    }

    private static String normalize(String value) {
        String trimmed = value.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    private void rejectPrivateHost(String host) {
        String normalized = host.toLowerCase(Locale.ROOT);
        if ("localhost".equals(normalized) || normalized.endsWith(".localhost")) {
            throw unsafe("自定义供应商地址不得指向本机或私有网络。");
        }
        try {
            resolveConnectionAddresses(host);
        } catch (UnknownHostException exception) {
            throw unsafe("自定义供应商地址无法解析或指向非公网地址。");
        }
    }

    private static boolean isPrivate(InetAddress address) {
        if (address.isAnyLocalAddress()
            || address.isLoopbackAddress()
            || address.isLinkLocalAddress()
            || address.isSiteLocalAddress()
            || address.isMulticastAddress()) {
            return true;
        }
        byte[] bytes = address.getAddress();
        if (address instanceof Inet4Address) {
            int first = bytes[0] & 0xff;
            int second = bytes[1] & 0xff;
            int third = bytes[2] & 0xff;
            return first == 0
                || first == 10
                || (first == 100 && second >= 64 && second <= 127)
                || first == 127
                || (first == 169 && second == 254)
                || (first == 172 && second >= 16 && second <= 31)
                || (first == 192 && second == 0 && third == 0)
                || (first == 192 && second == 0 && third == 2)
                || (first == 192 && second == 168)
                || (first == 192 && second == 88 && third == 99)
                || isBenchmarkFakeAddress(address)
                || (first == 198 && second == 51 && third == 100)
                || (first == 203 && second == 0 && third == 113)
                || first >= 224;
        }
        if (address instanceof Inet6Address) {
            int first = bytes[0] & 0xff;
            int second = bytes[1] & 0xff;
            return (first & 0xfe) == 0xfc
                || (first == 0xfe && (second & 0xc0) == 0x80)
                || isPrefix(bytes, 0x20, 0x01, 0x00, 0x00)
                || isPrefix(bytes, 0x20, 0x01, 0x0d, 0xb8)
                || (first == 0x20 && second == 0x02)
                || isIpv4TranslationPrefix(bytes);
        }
        return true;
    }

    private static boolean isBenchmarkFakeAddress(InetAddress address) {
        if (!(address instanceof Inet4Address)) {
            return false;
        }
        byte[] bytes = address.getAddress();
        return (bytes[0] & 0xff) == 198
            && ((bytes[1] & 0xff) == 18 || (bytes[1] & 0xff) == 19);
    }

    private static boolean isPrefix(byte[] bytes, int... prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int index = 0; index < prefix.length; index++) {
            if ((bytes[index] & 0xff) != prefix[index]) {
                return false;
            }
        }
        return true;
    }

    private static boolean isIpv4TranslationPrefix(byte[] bytes) {
        if (bytes.length != 16) {
            return false;
        }
        boolean firstTenZero = true;
        for (int index = 0; index < 10; index++) {
            firstTenZero &= bytes[index] == 0;
        }
        boolean mapped = firstTenZero
            && (bytes[10] & 0xff) == 0xff
            && (bytes[11] & 0xff) == 0xff;
        boolean nat64 = true;
        int[] prefix = {0x00, 0x64, 0xff, 0x9b};
        for (int index = 0; index < prefix.length; index++) {
            nat64 &= (bytes[index] & 0xff) == prefix[index];
        }
        for (int index = prefix.length; index < 12; index++) {
            nat64 &= bytes[index] == 0;
        }
        return mapped || nat64;
    }

    private static ApiException unsafe(String message) {
        return new ApiException("unsafe_provider_url", message, 400, false);
    }
}

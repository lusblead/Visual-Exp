package com.visualizedexp.backend.provider;

import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ConnectionRequestTimeoutException;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Component
public final class SafeHttpClient {
    private static final int MAX_REQUEST_BYTES = 4 * 1024 * 1024;
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private final CloseableHttpClient client;
    private final Duration requestTimeout;

    public SafeHttpClient(
        @Value("${app.providers.connect-timeout:10s}") Duration connectTimeout,
        @Value("${app.providers.request-timeout:45s}") Duration requestTimeout,
        ProviderUrlPolicy urlPolicy
    ) {
        var connectionManager = PoolingHttpClientConnectionManagerBuilder.create()
            .setDnsResolver(new SafeDnsResolver(urlPolicy))
            .setDefaultConnectionConfig(
                ConnectionConfig.custom()
                    .setConnectTimeout(Timeout.of(connectTimeout))
                    .setSocketTimeout(Timeout.of(requestTimeout))
                    .build()
            )
            .build();
        this.client = HttpClients.custom()
            .setConnectionManager(connectionManager)
            .setDefaultRequestConfig(
                RequestConfig.custom()
                    .setConnectionRequestTimeout(Timeout.of(connectTimeout))
                    .setResponseTimeout(Timeout.of(requestTimeout))
                    .setRedirectsEnabled(false)
                    .build()
            )
            .disableAutomaticRetries()
            .disableCookieManagement()
            .disableRedirectHandling()
            .build();
        this.requestTimeout = requestTimeout;
    }

    public Response send(HttpRequest.Builder builder, boolean ambiguousOnTransport) {
        HttpRequest request = builder.timeout(requestTimeout).build();
        try {
            HttpUriRequestBase outbound = new HttpUriRequestBase(
                request.method(),
                request.uri()
            );
            request.headers().map().forEach((name, values) -> {
                if (!isHopByHopOrTransportHeader(name)) {
                    values.forEach(value -> outbound.addHeader(name, value));
                }
            });
            if (request.bodyPublisher().isPresent()) {
                outbound.setEntity(
                    new ByteArrayEntity(
                        collectBody(request.bodyPublisher().orElseThrow()),
                        ContentType.APPLICATION_JSON
                    )
                );
            }

            return client.execute(outbound, response -> {
                if (response.getEntity() == null) {
                    return new Response(response.getCode(), "");
                }
                try (InputStream body = response.getEntity().getContent()) {
                    byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                    if (bytes.length > MAX_RESPONSE_BYTES) {
                        throw new UpstreamException(
                            "provider_response_too_large",
                            "供应商响应超过安全上限。",
                            502,
                            false,
                            false
                        );
                    }
                    return new Response(
                        response.getCode(),
                        new String(
                            bytes,
                            java.nio.charset.StandardCharsets.UTF_8
                        )
                    );
                }
            });
        } catch (SocketTimeoutException | ConnectionRequestTimeoutException exception) {
            throw new UpstreamException(
                "provider_timeout",
                "供应商请求超时。",
                504,
                true,
                ambiguousOnTransport
            );
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new UpstreamException(
                "provider_unavailable",
                "供应商请求被中断。",
                503,
                true,
                ambiguousOnTransport
            );
        } catch (IOException exception) {
            throw new UpstreamException(
                "provider_unavailable",
                "暂时无法连接供应商。",
                503,
                true,
                ambiguousOnTransport
            );
        }
    }

    private byte[] collectBody(HttpRequest.BodyPublisher publisher)
        throws IOException, InterruptedException {
        BodyCollector collector = new BodyCollector();
        publisher.subscribe(collector);
        try {
            return collector.result.get(
                requestTimeout.toMillis(),
                TimeUnit.MILLISECONDS
            );
        } catch (TimeoutException exception) {
            collector.cancel();
            throw new SocketTimeoutException("Timed out while preparing request body");
        } catch (ExecutionException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof IOException ioException) {
                throw ioException;
            }
            throw new IOException("Unable to prepare provider request body", cause);
        }
    }

    private static boolean isHopByHopOrTransportHeader(String name) {
        return switch (name.toLowerCase(Locale.ROOT)) {
            case "connection",
                "content-length",
                "expect",
                "host",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailer",
                "transfer-encoding",
                "upgrade" -> true;
            default -> false;
        };
    }

    private static final class SafeDnsResolver implements DnsResolver {
        private final ProviderUrlPolicy urlPolicy;

        private SafeDnsResolver(ProviderUrlPolicy urlPolicy) {
            this.urlPolicy = urlPolicy;
        }

        @Override
        public InetAddress[] resolve(String host) throws UnknownHostException {
            return urlPolicy.resolveConnectionAddresses(host);
        }

        @Override
        public String resolveCanonicalHostname(String host)
            throws UnknownHostException {
            resolve(host);
            return host;
        }
    }

    private static final class BodyCollector implements Flow.Subscriber<ByteBuffer> {
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private Flow.Subscription subscription;

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            subscription.request(Long.MAX_VALUE);
        }

        @Override
        public void onNext(ByteBuffer item) {
            byte[] chunk = new byte[item.remaining()];
            item.get(chunk);
            if (output.size() + chunk.length > MAX_REQUEST_BYTES) {
                cancel();
                result.completeExceptionally(
                    new IOException("Provider request body exceeds safe limit")
                );
                return;
            }
            output.writeBytes(chunk);
        }

        @Override
        public void onError(Throwable throwable) {
            result.completeExceptionally(throwable);
        }

        @Override
        public void onComplete() {
            result.complete(output.toByteArray());
        }

        private void cancel() {
            if (subscription != null) {
                subscription.cancel();
            }
        }
    }

    public record Response(int status, String body) {
    }
}

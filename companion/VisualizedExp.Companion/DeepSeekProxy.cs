using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace VisualizedExp.Companion;

internal sealed class DeepSeekProxy : IDisposable
{
    public const string SceneModel = "deepseek-v4-pro";
    public const string TermModel = "deepseek-v4-flash";
    public const string Model = SceneModel;

    private const int MaximumVerificationBytes = 1_048_576;
    private const int MaximumProxyResponseBytes = 8_388_608;
    private static readonly TimeSpan VerificationTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan ProxyTimeout = TimeSpan.FromSeconds(90);

    private readonly Uri baseUri;
    private readonly HttpClient httpClient;

    public DeepSeekProxy(Uri baseUri)
    {
        this.baseUri = baseUri;
        httpClient = new HttpClient(new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.All,
            UseCookies = false,
        })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    public async Task VerifyCredentialAsync(string apiKey, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUri, "models"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(VerificationTimeout);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new CompanionFailure("provider_timeout", "DeepSeek credential verification timed out.", 504);
        }
        catch (HttpRequestException)
        {
            throw new CompanionFailure(
                "provider_unavailable",
                "DeepSeek credential verification is temporarily unavailable.",
                503);
        }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                throw new CompanionFailure(
                    "credential_invalid",
                    "The DeepSeek API Key could not be verified.",
                    401);
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new CompanionFailure(
                    "provider_unavailable",
                    "DeepSeek credential verification is temporarily unavailable.",
                    503);
            }

            byte[] content;
            try
            {
                content = await ReadBoundedAsync(
                    response.Content,
                    MaximumVerificationBytes,
                    timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new CompanionFailure("provider_timeout", "DeepSeek credential verification timed out.", 504);
            }
            catch (InvalidDataException)
            {
                throw new CompanionFailure(
                    "provider_response_invalid",
                    "DeepSeek returned an invalid verification response.",
                    502);
            }

            try
            {
                using var document = JsonDocument.Parse(content);
                if (!ContainsRequiredModels(document.RootElement))
                {
                    throw new CompanionFailure(
                        "model_unavailable",
                        "The configured DeepSeek account must expose deepseek-v4-pro and deepseek-v4-flash.",
                        422);
                }
            }
            catch (JsonException)
            {
                throw new CompanionFailure(
                    "provider_response_invalid",
                    "DeepSeek returned an invalid verification response.",
                    502);
            }
            finally
            {
                Array.Clear(content);
            }
        }
    }

    public async Task<ProxyResponse> ForwardChatAsync(
        JsonElement incomingRequest,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var outgoingBody = BuildAllowedModelRequest(incomingRequest);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri(baseUri, "chat/completions"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new ByteArrayContent(outgoingBody);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(ProxyTimeout);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new CompanionFailure("provider_timeout", "The DeepSeek request timed out.", 504);
        }
        catch (HttpRequestException)
        {
            throw new CompanionFailure(
                "provider_unavailable",
                "DeepSeek is temporarily unavailable.",
                503);
        }
        finally
        {
            Array.Clear(outgoingBody);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw MapUpstreamFailure(response.StatusCode);
            }

            byte[] content;
            try
            {
                content = await ReadBoundedAsync(
                    response.Content,
                    MaximumProxyResponseBytes,
                    timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new CompanionFailure("provider_timeout", "The DeepSeek request timed out.", 504);
            }
            catch (InvalidDataException)
            {
                throw new CompanionFailure(
                    "provider_response_invalid",
                    "DeepSeek returned an invalid response.",
                    502);
            }

            try
            {
                using var document = JsonDocument.Parse(content);
                if (ContainsSecret(content, apiKey))
                {
                    throw new CompanionFailure(
                        "provider_response_rejected",
                        "DeepSeek returned an unsafe response.",
                        502);
                }

                var finishFailure = MapFinishReason(document.RootElement);
                if (finishFailure is not null)
                {
                    throw finishFailure;
                }

                return new ProxyResponse((int)response.StatusCode, content);
            }
            catch (JsonException)
            {
                Array.Clear(content);
                throw new CompanionFailure(
                    "provider_response_invalid",
                    "DeepSeek returned an invalid response.",
                    502);
            }
            catch
            {
                Array.Clear(content);
                throw;
            }
        }
    }

    public async Task<ProxyStreamResponse> OpenChatStreamAsync(
        JsonElement incomingRequest,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var outgoingBody = BuildAllowedModelRequest(incomingRequest);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri(baseUri, "chat/completions"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        request.Content = new ByteArrayContent(outgoingBody);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(ProxyTimeout);
        HttpResponseMessage? response = null;
        var handedOff = false;

        try
        {
            response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                throw MapUpstreamFailure(response.StatusCode);
            }

            if (!string.Equals(
                    response.Content.Headers.ContentType?.MediaType,
                    "text/event-stream",
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new CompanionFailure(
                    "provider_response_invalid",
                    "DeepSeek returned an invalid streaming response.",
                    502);
            }

            if (response.Content.Headers.ContentLength is > MaximumProxyResponseBytes)
            {
                throw new CompanionFailure(
                    "provider_response_invalid",
                    "DeepSeek returned an invalid streaming response.",
                    502);
            }

            var secret = Encoding.UTF8.GetBytes(apiKey);
            var streamResponse = new ProxyStreamResponse(
                (int)response.StatusCode,
                response,
                timeout,
                secret,
                MaximumProxyResponseBytes);
            handedOff = true;
            return streamResponse;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new CompanionFailure("provider_timeout", "The DeepSeek request timed out.", 504);
        }
        catch (HttpRequestException)
        {
            throw new CompanionFailure(
                "provider_unavailable",
                "DeepSeek is temporarily unavailable.",
                503);
        }
        finally
        {
            Array.Clear(outgoingBody);
            if (!handedOff)
            {
                response?.Dispose();
                timeout.Dispose();
            }
        }
    }

    public void Dispose()
    {
        httpClient.Dispose();
    }

    private static byte[] BuildAllowedModelRequest(JsonElement incomingRequest)
    {
        if (incomingRequest.ValueKind != JsonValueKind.Object)
        {
            throw new CompanionFailure(
                "invalid_proxy_request",
                "The DeepSeek request must be a JSON object.",
                400);
        }

        if (!incomingRequest.TryGetProperty("model", out var modelProperty) ||
            modelProperty.ValueKind != JsonValueKind.String ||
            !IsAllowedModel(modelProperty.GetString()))
        {
            throw new CompanionFailure(
                "model_not_allowed",
                "The DeepSeek proxy only allows the configured product models.",
                400);
        }

        var model = modelProperty.GetString()!;
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var property in incomingRequest.EnumerateObject())
            {
                if (!property.NameEquals("model"))
                {
                    property.WriteTo(writer);
                }
            }

            writer.WriteString("model", model);
            writer.WriteEndObject();
        }

        return stream.ToArray();
    }

    private static bool ContainsRequiredModels(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        var hasSceneModel = false;
        var hasTermModel = false;
        foreach (var item in data.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object &&
                item.TryGetProperty("id", out var id) &&
                id.ValueKind == JsonValueKind.String)
            {
                hasSceneModel |= string.Equals(
                    id.GetString(),
                    SceneModel,
                    StringComparison.Ordinal);
                hasTermModel |= string.Equals(
                    id.GetString(),
                    TermModel,
                    StringComparison.Ordinal);
            }
        }

        return hasSceneModel && hasTermModel;
    }

    private static bool IsAllowedModel(string? model)
    {
        return string.Equals(model, SceneModel, StringComparison.Ordinal) ||
            string.Equals(model, TermModel, StringComparison.Ordinal);
    }

    private static CompanionFailure MapUpstreamFailure(HttpStatusCode status)
    {
        return status switch
        {
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                new CompanionFailure(
                    "credential_invalid",
                    "The configured DeepSeek API Key is no longer valid.",
                    401),
            HttpStatusCode.PaymentRequired =>
                new CompanionFailure(
                    "provider_insufficient_balance",
                    "The DeepSeek account has insufficient balance.",
                    402),
            HttpStatusCode.UnprocessableEntity =>
                new CompanionFailure(
                    "provider_invalid_parameters",
                    "DeepSeek rejected one or more request parameters.",
                    422),
            HttpStatusCode.TooManyRequests =>
                new CompanionFailure(
                    "provider_rate_limited",
                    "DeepSeek is rate limiting this request.",
                    429),
            >= HttpStatusCode.BadRequest and < HttpStatusCode.InternalServerError =>
                new CompanionFailure(
                    "provider_rejected",
                    "DeepSeek rejected the request.",
                    400),
            _ =>
                new CompanionFailure(
                    "provider_unavailable",
                    "DeepSeek is temporarily unavailable.",
                    502),
        };
    }

    private static CompanionFailure? MapFinishReason(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var choice in choices.EnumerateArray())
        {
            if (choice.ValueKind != JsonValueKind.Object ||
                !choice.TryGetProperty("finish_reason", out var finishReason) ||
                finishReason.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            switch (finishReason.GetString())
            {
                case "content_filter":
                    return new CompanionFailure(
                        "provider_content_filtered",
                        "DeepSeek filtered the generated content.",
                        422);
                case "insufficient_system_resource":
                    return new CompanionFailure(
                        "provider_insufficient_resources",
                        "DeepSeek did not have enough inference resources.",
                        503);
            }
        }

        return null;
    }

    private static bool ContainsSecret(byte[] content, string apiKey)
    {
        var secret = Encoding.UTF8.GetBytes(apiKey);
        try
        {
            return content.AsSpan().IndexOf(secret) >= 0;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(secret);
        }
    }

    private static async Task<byte[]> ReadBoundedAsync(
        HttpContent content,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is > 0 &&
            content.Headers.ContentLength > maximumBytes)
        {
            throw new InvalidDataException("Response exceeds the configured bound.");
        }

        await using var input = await content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        var buffer = new byte[16_384];
        try
        {
            while (true)
            {
                var count = await input.ReadAsync(buffer, cancellationToken);
                if (count == 0)
                {
                    break;
                }

                if (output.Length + count > maximumBytes)
                {
                    throw new InvalidDataException("Response exceeds the configured bound.");
                }

                output.Write(buffer, 0, count);
            }

            return output.ToArray();
        }
        finally
        {
            Array.Clear(buffer);
        }
    }
}

internal sealed record ProxyResponse(int StatusCode, byte[] Body);

internal sealed class ProxyStreamResponse : IAsyncDisposable
{
    private readonly HttpResponseMessage response;
    private readonly CancellationTokenSource timeout;
    private readonly byte[] secret;
    private readonly int maximumBytes;
    private bool disposed;

    public ProxyStreamResponse(
        int statusCode,
        HttpResponseMessage response,
        CancellationTokenSource timeout,
        byte[] secret,
        int maximumBytes)
    {
        StatusCode = statusCode;
        this.response = response;
        this.timeout = timeout;
        this.secret = secret;
        this.maximumBytes = maximumBytes;
    }

    public int StatusCode { get; }

    public async Task CopyToAsync(Stream destination)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        await using var source = await response.Content.ReadAsStreamAsync(timeout.Token);
        var sourceBuffer = new byte[16_384];
        var retainedBuffer = new byte[Math.Max(secret.Length - 1, 0)];
        var scanBuffer = new byte[sourceBuffer.Length + retainedBuffer.Length];
        var retainedCount = 0;
        long totalBytes = 0;

        try
        {
            while (true)
            {
                var count = await source.ReadAsync(sourceBuffer, timeout.Token);
                if (count == 0)
                {
                    break;
                }

                totalBytes += count;
                if (totalBytes > maximumBytes)
                {
                    throw new InvalidDataException(
                        "Streaming response exceeds the configured bound.");
                }

                retainedBuffer.AsSpan(0, retainedCount).CopyTo(scanBuffer);
                sourceBuffer.AsSpan(0, count).CopyTo(scanBuffer.AsSpan(retainedCount));
                var scanCount = retainedCount + count;
                if (scanBuffer.AsSpan(0, scanCount).IndexOf(secret) >= 0)
                {
                    throw new InvalidDataException(
                        "Streaming response contains rejected data.");
                }

                var nextRetainedCount = Math.Min(retainedBuffer.Length, scanCount);
                var writeCount = scanCount - nextRetainedCount;
                if (writeCount > 0)
                {
                    await destination.WriteAsync(
                        scanBuffer.AsMemory(0, writeCount),
                        timeout.Token);
                    await destination.FlushAsync(timeout.Token);
                }

                if (nextRetainedCount > 0)
                {
                    scanBuffer
                        .AsSpan(writeCount, nextRetainedCount)
                        .CopyTo(retainedBuffer);
                }
                retainedCount = nextRetainedCount;
            }

            if (retainedCount > 0)
            {
                await destination.WriteAsync(
                    retainedBuffer.AsMemory(0, retainedCount),
                    timeout.Token);
                await destination.FlushAsync(timeout.Token);
            }
        }
        finally
        {
            Array.Clear(sourceBuffer);
            Array.Clear(retainedBuffer);
            Array.Clear(scanBuffer);
        }
    }

    public ValueTask DisposeAsync()
    {
        if (disposed)
        {
            return ValueTask.CompletedTask;
        }

        disposed = true;
        response.Dispose();
        timeout.Dispose();
        CryptographicOperations.ZeroMemory(secret);
        return ValueTask.CompletedTask;
    }
}

internal sealed class CompanionFailure : Exception
{
    public CompanionFailure(string code, string publicMessage, int statusCode)
        : base(code)
    {
        Code = code;
        PublicMessage = publicMessage;
        StatusCode = statusCode;
    }

    public string Code { get; }

    public string PublicMessage { get; }

    public int StatusCode { get; }
}

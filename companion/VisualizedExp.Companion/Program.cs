using System.ComponentModel;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace VisualizedExp.Companion;

public static class Program
{
    private const string BearerEnvironmentName = "VISUALIZED_EXP_COMPANION_TOKEN";
    private const string TestModeEnvironmentName = "VISUALIZED_EXP_COMPANION_TEST_MODE";
    private const string TestTargetEnvironmentName =
        "VISUALIZED_EXP_COMPANION_TEST_CREDENTIAL_TARGET";
    private const string TestContextTargetEnvironmentName =
        "VISUALIZED_EXP_COMPANION_TEST_CONTEXT_TARGET";
    private const string TestBaseUrlEnvironmentName =
        "VISUALIZED_EXP_COMPANION_TEST_DEEPSEEK_BASE_URL";
    private const string ProductionCredentialTarget = "VisualizedExp.DeepSeek.v4-pro";
    private const string ProductionContextTarget =
        "VisualizedExp.ExplanationContext.v1";
    private const string ProductionDeepSeekBaseUrl = "https://api.deepseek.com/";
    private const long MaximumRequestBytes = 1_048_576;

    public static async Task<int> Main(string[] args)
    {
        _ = args;

        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("STARTUP_ERROR unsupported_platform");
            return 2;
        }

        var bearerToken = Environment.GetEnvironmentVariable(BearerEnvironmentName)?.Trim();
        if (string.IsNullOrEmpty(bearerToken))
        {
            Console.Error.WriteLine("STARTUP_ERROR missing_companion_token");
            return 2;
        }

        CompanionOptions options;
        try
        {
            options = ReadOptions(bearerToken);
        }
        catch (CompanionFailure failure)
        {
            Console.Error.WriteLine($"STARTUP_ERROR {failure.Code}");
            return 2;
        }

        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server =>
        {
            server.AddServerHeader = false;
            server.Limits.MaxRequestBodySize = MaximumRequestBytes;
            server.Listen(IPAddress.Loopback, 0);
        });

        var store = new WindowsCredentialStore(options.CredentialTarget);
        var contextSecretStore = new WindowsCredentialStore(options.ContextSecretTarget);
        using var proxy = new DeepSeekProxy(options.DeepSeekBaseUri);
        var app = builder.Build();

        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";

            if (context.Request.Headers.ContainsKey("Origin"))
            {
                await SafeResult(
                    403,
                    "origin_rejected",
                    "Browser-origin requests are not accepted.").ExecuteAsync(context);
                return;
            }

            if (!RequireAuthorization(context.Request, options.BearerToken))
            {
                await SafeResult(
                    401,
                    "unauthorized",
                    "A valid local companion bearer is required.").ExecuteAsync(context);
                return;
            }

            try
            {
                await next(context);
            }
            catch
            {
                if (!context.Response.HasStarted)
                {
                    await SafeResult(
                        500,
                        "local_companion_failed",
                        "The local companion operation failed.").ExecuteAsync(context);
                }
            }
        });

        app.MapGet("/v1/status", () => CredentialStatus(store));
        app.MapPut(
            "/v1/credentials/deepseek",
            (HttpRequest request, CancellationToken cancellationToken) =>
                SaveCredential(request, store, proxy, cancellationToken));
        app.MapDelete(
            "/v1/credentials/deepseek",
            () => DeleteCredential(store));
        app.MapGet(
            "/v1/runtime/explanation-context-secret",
            () => ExplanationContextSecret(contextSecretStore));
        if (options.TestMode)
        {
            app.MapDelete(
                "/v1/runtime/explanation-context-secret",
                () => DeleteExplanationContextSecret(contextSecretStore));
        }
        app.MapPost(
            "/v1/deepseek/chat/completions",
            (HttpRequest request, CancellationToken cancellationToken) =>
                ProxyChat(request, store, proxy, cancellationToken));

        await app.StartAsync();
        var address = app.Services
            .GetRequiredService<IServer>()
            .Features
            .Get<IServerAddressesFeature>()?
            .Addresses
            .SingleOrDefault(value => value.StartsWith("http://127.0.0.1:", StringComparison.Ordinal));

        if (address is null)
        {
            await app.StopAsync();
            Console.Error.WriteLine("STARTUP_ERROR loopback_binding_failed");
            return 3;
        }

        Console.WriteLine($"READY {address}");
        await Console.Out.FlushAsync();
        await app.WaitForShutdownAsync();
        return 0;
    }

    internal static bool RequireAuthorization(HttpRequest request, string expectedToken)
    {
        var header = request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        if (!header.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var supplied = header[prefix.Length..];
        if (supplied.Length == 0)
        {
            return false;
        }

        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        var expectedBytes = Encoding.UTF8.GetBytes(expectedToken);
        try
        {
            return suppliedBytes.Length == expectedBytes.Length &&
                CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(suppliedBytes);
            CryptographicOperations.ZeroMemory(expectedBytes);
        }
    }

    internal static async Task<string> ReadCredentialRequestAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength is > MaximumRequestBytes)
        {
            throw InvalidCredentialInput();
        }

        JsonDocument document;
        try
        {
            document = await JsonDocument.ParseAsync(
                request.Body,
                new JsonDocumentOptions { MaxDepth = 4 },
                cancellationToken);
        }
        catch (JsonException)
        {
            throw InvalidCredentialInput();
        }
        catch (IOException)
        {
            throw InvalidCredentialInput();
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                root.EnumerateObject().Count() != 1 ||
                !root.TryGetProperty("apiKey", out var value) ||
                value.ValueKind != JsonValueKind.String)
            {
                throw InvalidCredentialInput();
            }

            var apiKey = value.GetString()?.Trim() ?? string.Empty;
            if (apiKey.Length is < 16 or > 512 ||
                apiKey.Any(character => char.IsWhiteSpace(character) || char.IsControl(character)))
            {
                throw InvalidCredentialInput();
            }

            return apiKey;
        }
    }

    internal static async Task<IResult> SaveCredential(
        HttpRequest request,
        WindowsCredentialStore store,
        DeepSeekProxy proxy,
        CancellationToken cancellationToken)
    {
        try
        {
            var candidate = await ReadCredentialRequestAsync(request, cancellationToken);
            await proxy.VerifyCredentialAsync(candidate, cancellationToken);
            store.Write(candidate);
            return CredentialStatus(store);
        }
        catch (CompanionFailure failure)
        {
            return SafeResult(failure.StatusCode, failure.Code, failure.PublicMessage);
        }
        catch (Win32Exception)
        {
            return SafeResult(
                503,
                "credential_store_unavailable",
                "Windows Credential Manager is temporarily unavailable.");
        }
    }

    internal static IResult DeleteCredential(WindowsCredentialStore store)
    {
        try
        {
            store.Delete();
            return StatusPayload(false);
        }
        catch (Win32Exception)
        {
            return SafeResult(
                503,
                "credential_store_unavailable",
                "Windows Credential Manager is temporarily unavailable.");
        }
    }

    internal static async Task<IResult> ProxyChat(
        HttpRequest request,
        WindowsCredentialStore store,
        DeepSeekProxy proxy,
        CancellationToken cancellationToken)
    {
        string? apiKey;
        try
        {
            apiKey = store.Read();
        }
        catch (Win32Exception)
        {
            return SafeResult(
                503,
                "credential_store_unavailable",
                "Windows Credential Manager is temporarily unavailable.");
        }

        if (string.IsNullOrEmpty(apiKey))
        {
            return SafeResult(
                409,
                "credential_required",
                "Configure a DeepSeek API Key before using the model.");
        }

        JsonDocument document;
        try
        {
            document = await JsonDocument.ParseAsync(
                request.Body,
                new JsonDocumentOptions { MaxDepth = 64 },
                cancellationToken);
        }
        catch (JsonException)
        {
            return SafeResult(
                400,
                "invalid_proxy_request",
                "The DeepSeek request must be valid JSON.");
        }
        catch (IOException)
        {
            return SafeResult(
                400,
                "invalid_proxy_request",
                "The DeepSeek request must be valid JSON.");
        }

        using (document)
        {
            try
            {
                if (RequestsStreaming(document.RootElement))
                {
                    var streamResponse = await proxy.OpenChatStreamAsync(
                        document.RootElement,
                        apiKey,
                        cancellationToken);
                    return new ProxyStreamResult(streamResponse);
                }

                var response = await proxy.ForwardChatAsync(
                    document.RootElement,
                    apiKey,
                    cancellationToken);
                var payload = Encoding.UTF8.GetString(response.Body);
                Array.Clear(response.Body);
                return Results.Content(
                    payload,
                    "application/json; charset=utf-8",
                    Encoding.UTF8,
                    response.StatusCode);
            }
            catch (CompanionFailure failure)
            {
                return SafeResult(failure.StatusCode, failure.Code, failure.PublicMessage);
            }
        }
    }

    private static bool RequestsStreaming(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
        {
            return false;
        }
        if (!request.TryGetProperty("stream", out var stream))
        {
            return false;
        }
        if (stream.ValueKind == JsonValueKind.True)
        {
            return true;
        }
        if (stream.ValueKind == JsonValueKind.False)
        {
            return false;
        }
        throw new CompanionFailure(
            "invalid_proxy_request",
            "The DeepSeek stream option must be a boolean.",
            400);
    }

    internal static IResult CredentialStatus(WindowsCredentialStore store)
    {
        try
        {
            return StatusPayload(store.IsConfigured());
        }
        catch (Win32Exception)
        {
            return SafeResult(
                503,
                "credential_store_unavailable",
                "Windows Credential Manager is temporarily unavailable.");
        }
    }

    internal static IResult ExplanationContextSecret(
        WindowsCredentialStore contextSecretStore)
    {
        try
        {
            var secret = contextSecretStore.Read();
            if (string.IsNullOrEmpty(secret))
            {
                secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
                contextSecretStore.Write(secret);
            }

            return Results.Json(
                new { secret },
                contentType: "application/json; charset=utf-8");
        }
        catch
        {
            return SafeResult(
                503,
                "context_secret_store_unavailable",
                "The explanation context secret store is temporarily unavailable.");
        }
    }

    internal static IResult DeleteExplanationContextSecret(
        WindowsCredentialStore contextSecretStore)
    {
        try
        {
            contextSecretStore.Delete();
            return Results.Json(
                new { deleted = true },
                contentType: "application/json; charset=utf-8");
        }
        catch
        {
            return SafeResult(
                503,
                "context_secret_store_unavailable",
                "The explanation context secret store is temporarily unavailable.");
        }
    }

    internal static IResult SafeResult(int statusCode, string code, string message)
    {
        return Results.Json(
            new { error = new { code, message } },
            statusCode: statusCode,
            contentType: "application/json; charset=utf-8");
    }

    private static IResult StatusPayload(bool configured)
    {
        return Results.Json(
            new
            {
                configured,
                provider = "deepseek",
                model = DeepSeekProxy.Model,
                storage = "windows_credential_manager",
            },
            contentType: "application/json; charset=utf-8");
    }

    private static CompanionFailure InvalidCredentialInput()
    {
        return new CompanionFailure(
            "invalid_credential_input",
            "Enter one valid single-line DeepSeek API Key.",
            400);
    }

    private static CompanionOptions ReadOptions(string bearerToken)
    {
        var testMode = string.Equals(
            Environment.GetEnvironmentVariable(TestModeEnvironmentName),
            "1",
            StringComparison.Ordinal);
        var credentialTarget = ProductionCredentialTarget;
        var contextSecretTarget = ProductionContextTarget;
        var baseUri = new Uri(ProductionDeepSeekBaseUrl, UriKind.Absolute);

        if (testMode)
        {
            var targetOverride = Environment.GetEnvironmentVariable(TestTargetEnvironmentName)?.Trim();
            if (!string.IsNullOrEmpty(targetOverride))
            {
                if (targetOverride.Length > 256 || targetOverride.Any(char.IsControl))
                {
                    throw new CompanionFailure(
                        "invalid_test_credential_target",
                        "The test credential target is invalid.",
                        500);
                }

                credentialTarget = targetOverride;
            }

            var contextTargetOverride =
                Environment.GetEnvironmentVariable(TestContextTargetEnvironmentName)?.Trim();
            if (!string.IsNullOrEmpty(contextTargetOverride))
            {
                if (
                    contextTargetOverride.Length > 256 ||
                    contextTargetOverride.Any(char.IsControl))
                {
                    throw new CompanionFailure(
                        "invalid_test_context_target",
                        "The test context-secret target is invalid.",
                        500);
                }

                contextSecretTarget = contextTargetOverride;
            }

            var baseUrlOverride = Environment.GetEnvironmentVariable(TestBaseUrlEnvironmentName)?.Trim();
            if (!string.IsNullOrEmpty(baseUrlOverride))
            {
                if (!Uri.TryCreate(baseUrlOverride, UriKind.Absolute, out var candidate) ||
                    candidate.Scheme != Uri.UriSchemeHttp ||
                    candidate.UserInfo.Length > 0 ||
                    candidate.Query.Length > 0 ||
                    candidate.Fragment.Length > 0 ||
                    candidate.AbsolutePath != "/" ||
                    !IsLoopbackHost(candidate.Host))
                {
                    throw new CompanionFailure(
                        "invalid_test_upstream",
                        "The test DeepSeek upstream must be an HTTP loopback origin.",
                        500);
                }

                baseUri = candidate;
            }
        }

        return new CompanionOptions(
            bearerToken,
            credentialTarget,
            contextSecretTarget,
            baseUri,
            testMode);
    }

    private static bool IsLoopbackHost(string host)
    {
        return string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));
    }
}

internal sealed record CompanionOptions(
    string BearerToken,
    string CredentialTarget,
    string ContextSecretTarget,
    Uri DeepSeekBaseUri,
    bool TestMode);

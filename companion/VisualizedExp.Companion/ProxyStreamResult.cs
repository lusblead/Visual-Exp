namespace VisualizedExp.Companion;

internal sealed class ProxyStreamResult : IResult
{
    private readonly ProxyStreamResponse response;

    public ProxyStreamResult(ProxyStreamResponse response)
    {
        this.response = response;
    }

    public async Task ExecuteAsync(HttpContext httpContext)
    {
        await using (response)
        {
            httpContext.Response.StatusCode = response.StatusCode;
            httpContext.Response.ContentType = "text/event-stream; charset=utf-8";
            httpContext.Response.Headers.CacheControl = "no-store";
            await response.CopyToAsync(httpContext.Response.Body);
        }
    }
}

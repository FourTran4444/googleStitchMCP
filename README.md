# Google Stitch MCP on Cloudflare

A small, dependency-free Cloudflare Worker that forwards MCP requests to Google's official Stitch server. Use it to connect a compatible MCP client to Stitch with your own API key.

Community project; not affiliated with or endorsed by Google, Cloudflare, or OpenAI. The MIT license covers this proxy, not Google's service or its generated content.

## How it works

Your MCP client → your Cloudflare Worker → `https://stitch.googleapis.com/mcp`.

- `POST`, `GET`, and `DELETE` on `/mcp` are forwarded to the fixed Google endpoint.
- Each request supplies `X-Goog-Api-Key`; Google validates it. A syntactically valid key alone does not prove authorization.
- JSON, event streams, MCP session IDs, protocol versions, and retry hints pass through.
- Keys are not stored by the application. Request logging is disabled in the deployment configuration.
- Redirects are rejected and design mutations are never automatically retried.
- `/health` reports proxy availability only, not authenticated Stitch access.

This proxy does not implement its own design tools. Tools are discovered from Google after authentication. Google's available tools, quotas, and permissions determine what you can create or edit.

## Deploy your own Worker

Requirements: Node.js 22 or newer, npm, a Cloudflare account, and a Stitch API key.

```sh
git clone https://github.com/FourTran4444/googleStitchMCP.git
cd googleStitchMCP
npm test
npx wrangler@4 login
npx wrangler@4 deploy
```

Change `name` in `wrangler.toml` if needed. Wrangler displays your deployed URL. No database, KV namespace, or server-side Stitch secret is required. Cloudflare usage and Google quotas apply; this project does not guarantee free hosting.

Create your key in [Google Stitch](https://stitch.google.com/) → profile menu → Stitch settings → API key. Enter it into your client's secure credential settings. Do not put a real key in source files, URLs, GitHub issues, screenshots, or chat.

## Connect ChatGPT

The `examples/chatgpt-plugin` directory contains a portable plugin manifest and MCP connection template:

1. Replace `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp` in `mcp.json` with your deployed endpoint.
2. Package `plugin.json` and `mcp.json` together and use a ChatGPT plugin import/creation workflow that supports remote MCP and API-key authentication.
3. Connect the plugin and enter your Stitch API key in its secure credential field. The configuration uses the custom header `X-Goog-Api-Key`.
4. Ask ChatGPT to list your Stitch projects, then request a design in a chosen project.

Availability depends on your ChatGPT account and client. A URL-only or OAuth-only connector cannot use this API-key proxy without a compatible connection workflow. This repository does not implement OAuth or publish a public ChatGPT directory listing.

For other clients, configure Streamable HTTP at your `/mcp` endpoint with a securely supplied `X-Goog-Api-Key` header. If your client supports Google's endpoint directly, you may connect directly without this proxy.

## Verify and troubleshoot

```sh
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/health
curl -i -X POST https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

The first request should return `200`; the second should return `401`. Then use your authenticated client's tool discovery and list-projects operation. Test design generation only when you intend to create a screen.

- **401 / 403:** check the secure credential setting and Google account/API access.
- **404:** use the exact `/mcp` path without query parameters.
- **502:** upstream unavailable or redirected. Check your Stitch project before retrying a creation request to avoid duplicates.
- **Long-running design request:** client and service timeouts still apply. Inspect Stitch before retrying.

Validation status: proxy unit tests and the original deployment's health/missing-key checks passed. Authenticated upstream discovery and design generation have not yet been verified with an owner-provided key.

## Security and trust

Self-host when possible. The Worker operator and infrastructure process the API key and design traffic in transit; “not stored” does not mean the proxy cannot access them. There is no shared owner credential, app database, or application cache. Platform metadata may still be retained by hosting providers.

The public endpoint accepts requests from anyone supplying their own key, consuming the operator's Worker quota. Apply deployment-level access/rate controls appropriate to your use. Browser cross-origin use is intentionally not enabled. See [SECURITY.md](SECURITY.md).

## Development

```sh
npm test
npx wrangler@4 dev
```

Tests use Node's built-in test runner and mocked upstream responses. They do not contact Google or create designs. See [CONTRIBUTING.md](CONTRIBUTING.md).

## References

- [Google's Stitch MCP API-key configuration](https://github.com/gemini-cli-extensions/stitch/blob/main/gemini-extension-apikey.json)
- [Google's Stitch setup guide](https://codelabs.developers.google.com/design-to-code-with-antigravity-stitch)
- [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)

## License

[MIT](LICENSE) © 2026 Tu Tran.

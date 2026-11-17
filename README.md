# Google Stitch MCP on Cloudflare

[![MIT License](https://img.shields.io/badge/license-MIT-7c3aed.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020.svg)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/protocol-MCP-38bdf8.svg)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/tests-23%20passing-22c55e.svg)](#verification)

MIT-licensed community bridge between ChatGPT and Google's Stitch MCP. Not affiliated with Google, OpenAI, or Cloudflare.

**[Open the maintained service](https://stitch-mcp.tranvantu4444.workers.dev/)** · **[Connect from ChatGPT](#connect-from-chatgpt-web)** · **[Deploy your own](#self-host)** · **[Security model](SECURITY.md)**

## Why we built it

Google Stitch authenticates MCP requests with an API key, while ChatGPT web custom MCP connections use OAuth. That mismatch meant ChatGPT could not work with Stitch through a normal secure connection without another component translating between the two authentication models.

We built this bridge so a user can authorize ChatGPT with their own Stitch API key without sharing a Gmail password, pasting the key into chat, or embedding it in a public plugin manifest. The Cloudflare Worker validates the key against Google's Stitch MCP, encrypts it for a time-limited grant, and uses it only when forwarding authorized MCP requests.

We made the complete project open source because it sits on a sensitive trust boundary. Users should be able to inspect how credentials are processed, understand what the operator can access, contribute security improvements, and deploy an independent copy under their own Cloudflare account.

## Why this project is open source

This bridge handles a sensitive credential, so its behavior should be inspectable. The complete request path is in this repository: the Cloudflare Worker, OAuth flow, encrypted grant storage, database migration, tests, deployment configuration, security notes, and contribution guide.

- **Use the maintained deployment** for the shortest setup path.
- **Self-host the same code** when you want full control of infrastructure, secrets, logs, and retention.
- **Audit or fork it** under the MIT license. Issues and pull requests are welcome.

The live interface always identifies itself as a community project and links back to this repository. The operator can process API keys and MCP traffic at runtime; open source makes that implementation visible, but does not remove the need to trust the deployment you choose.

## Connect from ChatGPT web

1. Open **Plugins → + → Add custom MCP server**.
2. Name it **Stitch MCP**. Use `https://stitch-mcp.tranvantu4444.workers.dev/mcp` for the maintained deployment, or your own deployed endpoint.
3. Choose **OAuth**. Discovery provides the endpoints automatically. If advanced settings ask for a client setup method, select **Dynamic client registration (DCR)**. No client secret is required. Scopes: `stitch offline_access`.
4. Review the connection warning and create the plugin. Complete authorization when prompted.
5. On the **Stitch Cloudflare** authorization page, enter your Stitch API key and explicitly approve access. Never enter your Gmail password or put the key in chat.
6. Install/select the resulting plugin in a conversation and ask **List my Stitch projects**.

Generate a key at [Google Stitch](https://stitch.google.com/) → profile → Stitch settings → API key.

The old downloadable plugin package did not establish a ChatGPT web connection. Use **Add custom MCP server** above. The portable example now declares OAuth, but packaging alone still does not activate a web connection.

If ChatGPT cached the old OAuth-discovery failure, close and reopen the creation dialog and enter the same server URL again. Do not select no authentication.

## Authentication and data handling

ChatGPT → OAuth access token → Cloudflare → Stitch API key → Google Stitch.

- OAuth authorization code flow with S256 PKCE and dynamic registration of public clients.
- Redirects restricted to the documented ChatGPT HTTPS callback paths and exactly matched to the registered client.
- Explicit consent, same-origin form submissions, short-lived CSRF cookie, and one-time authorization transaction.
- Read-only Google MCP initialization validates the key before storing a grant. No screen is generated as a connection test.
- API keys encrypted with AES-256-GCM, bound to individual grants. Encryption key is a Cloudflare secret.
- Opaque access/refresh tokens stored as SHA-256 hashes. Access expires after one hour; refresh rotates on each use. Authorization codes expire after five minutes and are consumed atomically.
- Grants expire after 30 days, requiring reauthorization. Revocation disables every access/refresh token for the affected grant immediately.
- Daily cleanup removes expired records. Hosting backups may retain deleted encrypted records under Cloudflare's retention policy.

**The proxy operator can process credentials and traffic at runtime. Self-host if you do not trust the operator.** Source is open; this is not an independent security certification. No OIDC email identity, Google sign-in, or enterprise verified-email integration is implemented.

## Revoke access

Open `/manage` on your Worker and enter the same Stitch key to revoke its stored connections. Alternatively, OAuth clients can POST `token` and `client_id` to `/revoke`. Disconnecting in ChatGPT should not be assumed to call revocation. Revoking the API key in Google Stitch also blocks upstream use.

## Self-host

Requirements: Node.js **22.13+** (tests use built-in SQLite), npm, Cloudflare Workers and D1 access.

```sh
git clone https://github.com/FourTran4444/googleStitchMCP.git
cd googleStitchMCP
npm test
npx wrangler@4 login
npx wrangler@4 d1 create stitch-mcp-oauth
```

Edit `wrangler.toml`: choose your Worker name, set `PUBLIC_ORIGIN` to its exact HTTPS origin (no trailing slash), and replace the D1 ID with the one returned above. The checked-in IDs describe the maintained deployment, not credentials; forks must use their own resources.

```sh
npx wrangler@4 d1 migrations apply stitch-mcp-oauth --remote
npx wrangler@4 secret put ENCRYPTION_KEY
npx wrangler@4 deploy
```

At the secret prompt, enter a cryptographically random 32-byte base64url value generated locally (for example with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Keep it out of Git. Losing or replacing it invalidates existing encrypted credentials; revoke old grants before rotating it. Never use a Stitch key as the encryption key.

Cloudflare dashboard Git integration: connect this repository to the Worker, production branch `main`, root repository directory, build command `npm test && npm run check`, deploy command `npx wrangler@4 deploy`. Provision D1, apply migrations, and configure the encryption secret before the first deployment. Keep Node.js at 22.13+ or 24.

No paid-plan upgrade is required by this code. Provider quotas and usage charges depend on your account. Deployments are public endpoints; rate limiting is an operator responsibility.

## Endpoints

| Path | Purpose |
|---|---|
| `/mcp` | Authenticated Streamable HTTP proxy |
| `/.well-known/oauth-protected-resource/mcp` | Resource discovery |
| `/.well-known/oauth-authorization-server` | OAuth discovery |
| `/register` | Dynamic public-client registration |
| `/authorize` | Credential entry and consent |
| `/token` | Code exchange and refresh rotation |
| `/revoke` | Token-based grant revocation |
| `/manage` | Key-based connection revocation |
| `/health` | Proxy liveness only |

Clients supporting secure custom headers can still send `X-Goog-Api-Key` directly. ChatGPT web uses OAuth. The fixed upstream is `https://stitch.googleapis.com/mcp`; credentials are never forwarded on redirects, and mutations are not automatically retried.

## Verification

```sh
npm test
npm run check
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/.well-known/oauth-authorization-server
curl -i -X POST https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Expect discovery JSON with S256 PKCE and DCR, and an unauthenticated MCP `401` containing `WWW-Authenticate`. Unit tests use real SQLite and Web Crypto with mocked Google responses. Live Google access and actual ChatGPT design creation require a real user key and must be verified separately; deployment or a successful health check is not evidence of that acceptance.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [MIT license](LICENSE).

References: [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth), [Google Stitch API-key configuration](https://github.com/gemini-cli-extensions/stitch/blob/main/gemini-extension-apikey.json).

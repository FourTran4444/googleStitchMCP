# Security

Do not publish real keys, tokens, session IDs, or private designs. Revoke an exposed Stitch key in Google Stitch and authorize again with a new key.

Use private GitHub vulnerability reporting if enabled, or a private contact listed by the maintainer. Do not disclose exploit details publicly before coordination.

OAuth keys are AES-GCM encrypted in D1 with a secret binding; plaintext is present only while serving authorized requests. Token hashes, encrypted grants, client registrations and temporary authorization records are stored in D1. The operator and hosting infrastructure remain trusted. Daily cleanup removes expired state; hosting backups have separate retention. Revoking a grant removes the active encrypted key record.

S256 PKCE, exact registered callbacks, a ChatGPT callback allowlist, same-origin POST checks, CSRF cookies, single-use transactions, and atomic code/refresh consumption protect authorization. Access tokens are audience/scope checked. Rotation rejects reused refresh tokens; it does not implement automatic family revocation on replay. Grants have a fixed 30-day maximum lifetime. Reauthorize after expiration.

DCR is public and registration is not proof of OpenAI client identity. Only documented ChatGPT callback URLs are accepted. This service does not verify ChatGPT mTLS certificates or OIDC email identities. Direct API-key clients remain supported.

No application request logging or cache is enabled. Infrastructure can retain operational metadata. Hosts must configure suitable rate limits and usage controls before operating at public scale; application-level rate limiting is not implemented. Do not add a shared Stitch credential or no-auth design access.

Never regenerate ENCRYPTION_KEY casually: existing grants depend on it. Revoke existing grants before key rotation. Keep it in Cloudflare Secrets, not source control.

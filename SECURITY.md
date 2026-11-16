# Security

Never include real API keys, authorization headers, session IDs, or private designs in issues or pull requests. Revoke an exposed Stitch key in Google Stitch immediately and replace it in your client's secure settings.

For sensitive vulnerabilities, use GitHub's private vulnerability reporting if enabled. Otherwise contact the maintainer through a private channel listed on their GitHub profile; do not publish exploit details or credentials in a public issue.

The Worker uses a fixed upstream, rejects redirects, forwards only selected headers, disables application logging, and does not persist keys. The operator can still access traffic and credentials at runtime. Self-host or connect directly to Google when you do not trust a proxy operator.

Google enforces key validity and authorization. This proxy does not provide user registration, OAuth, quota enforcement, key revocation, or rate limiting. Hosts should apply suitable Cloudflare controls. Do not add a shared Google key or an unauthenticated fallback.

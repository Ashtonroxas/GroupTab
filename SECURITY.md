Security and deployment checklist
===============================

Overview
--------
This file lists the minimum security steps and environment variables required to run GroupTab safely in production.

Required environment variables (set as secrets on your host, e.g., Vercel):
- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON contents of a Firebase service account key (string). Use platform secrets — do NOT commit.
- `CORS_ORIGINS`: comma-separated allowed origins (e.g. `https://app.example.com`). Default in development is `http://localhost:3000`.
- `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW`: tuning for rate limiting (defaults exist).
- `X_API_KEY` (optional): fallback API key. Prefer Firebase Auth.

Best practices
--------------
- Never commit service account JSON or `.env` files. Add them to `.gitignore` (already done).
- Use `FIREBASE_SERVICE_ACCOUNT_JSON` only with least-privilege service accounts.
- Enforce HTTPS and HSTS at the platform/load-balancer level.
- Use the hosting provider's secrets store for env vars (Vercel Environment Variables / GitHub Secrets).
- Add a Web Application Firewall (WAF) or rely on the cloud provider's protections.
- Replace in-memory rate limiting with a shared store (Redis) if you run multiple instances.
- Monitor errors using an observability tool (Sentry, Datadog) and ship logs to a central location.

Deployment checklist
--------------------
1. Configure the above environment variables as secrets on Vercel.
2. Set `FLASK_ENV=production`.
3. Verify `CORS_ORIGINS` contains only your production domains.
4. Validate CSP and remove `unsafe-inline`/`unsafe-eval` where feasible.
5. Run smoke tests after deployment to confirm auth verification and headers are present.

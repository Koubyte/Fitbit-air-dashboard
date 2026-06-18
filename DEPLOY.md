# Coolify deploy

Use the root `docker-compose.yml`.

Required Coolify env vars:

```dotenv
PUBLIC_APP_URL=https://your-dashboard-domain
GOOGLE_REDIRECT_URI=https://your-dashboard-domain/api/auth/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=use-a-long-random-password
GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION=Bearer use-a-long-random-token
WEBHOOK_FORWARD_SECRET=use-a-different-long-random-token
```

Google Cloud OAuth client:

- Application type: Web application
- Authorized redirect URI: same value as `GOOGLE_REDIRECT_URI`
- Add your Gmail as a test user while app stays in Testing
- Add Google Health API readonly scopes for health metrics, sleep, and activity

After deploy:

1. Open `PUBLIC_APP_URL`.
2. Sign in with `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.
3. Settings -> Connect Google.
4. Accept Google scopes.
5. Switch to Live Data.

OAuth token is stored in Docker volume `google_health_data`, not in Git.

Google Health webhooks:

- Public endpoint: `https://your-dashboard-domain/api/webhooks/google-health`
- `endpointAuthorization.secret`: same full value as `GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION`, including the `Bearer ` prefix.
- Subscriber config: use `subscriptionCreatePolicy: AUTOMATIC`.
- Useful data types for this dashboard: `heart-rate`, `heart-rate-variability`, `daily-heart-rate-zones`, `time-in-heart-rate-zone`, `daily-resting-heart-rate`, `daily-oxygen-saturation`, `daily-heart-rate-variability`, `daily-vo2-max`, `sleep`, `steps`.
- Google requires the Google Cloud project number, not the project ID, for `projects/{project-number}/subscribers`.
- Webhook status after deploy: `https://your-dashboard-domain/api/webhook-status`.

Local Docker test:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

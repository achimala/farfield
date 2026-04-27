# Cloudflare Pages Deploy

Farfield's hosted web frontend is a static Vite build deployed to Cloudflare Pages.

## Production Flow

Pushing to `main` runs `.github/workflows/deploy-cloudflare-pages.yml`.

The workflow:

1. Installs dependencies with Bun `1.3.6`.
2. Typechecks the web app.
3. Runs the web tests.
4. Builds `@farfield/web`.
5. Uploads `apps/web/dist` to Cloudflare Pages with Wrangler.

## Cloudflare Setup

Create a Cloudflare Pages project named `farfield`, or set the GitHub repository variable `CLOUDFLARE_PAGES_PROJECT_NAME` to the existing Pages project name.

Set the Pages project's production branch to `main`.

Add these GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The API token needs Cloudflare Pages edit access for the account.

Attach `farfield.app` to the Pages project in Cloudflare:

1. Open Cloudflare dashboard.
2. Go to Workers & Pages.
3. Select the Farfield Pages project.
4. Open Custom domains.
5. Add `farfield.app`.

Cloudflare requires the custom domain to be attached to the Pages project. DNS alone is not enough.

# SettleUply frontend

Angular 21 standalone application. Use Node 22, version 22.12 or later.

```sh
npm ci
npm start
npm run build
npm run format
```

`npm start` serves http://localhost:4200 and uses the local API at `http://localhost:8000/api/v1` from `src/app/core/environment.ts`.

`npm run build` creates the production bundle using `src/app/core/environment.production.ts`. Production API requests go to `https://api.settleuply.rocketreach.in/api/v1`. Angular replaces the environment file at build time; frontend environment variables are public configuration and must never contain API keys or backend secrets.

For a static hosting service, use these settings (paths are relative to the frontend repository):

| Setting                  | Value                                                                      |
| ------------------------ | -------------------------------------------------------------------------- |
| Install command          | `npm ci`                                                                   |
| Build command            | `npm run build`                                                            |
| Publish directory        | `dist/settleuply/browser`                                                  |
| Single-page app fallback | Rewrite requests that do not match a file to `/index.html` with status 200 |
| Public URL               | HTTPS at the domain root (`/`)                                             |

Deploy the contents of `dist/settleuply/browser`, not the parent directory. The route fallback lets direct links such as `/auth/login`, `/admin`, and `/dashboard` load after a browser refresh. If the host uses one combined build command, use `npm ci && npm run build`.

The planned frontend domain is `https://settleuply.rocketreach.in` (hosting provider still to be selected). Once confirmed, configure these values on the **live backend**, then restart or redeploy it:

```dotenv
APP_ENV=production
FRONTEND_URL=https://settleuply.rocketreach.in
```

`FRONTEND_URL` must be the exact frontend origin, with scheme and hostname and no path. It controls both CORS and the refresh/logout origin check. `APP_ENV=production` makes the backend mark refresh cookies Secure. If the chosen domain changes, update `FRONTEND_URL` accordingly.

The backend currently uses `SameSite=Strict` refresh cookies. Host the frontend on an HTTPS subdomain of `rocketreach.in` so it is same-site with the API. For example, if you choose `https://settleuply.rocketreach.in`, set `FRONTEND_URL=https://settleuply.rocketreach.in`. A provider's default hostname such as `*.onrender.com` or `*.vercel.app` is cross-site; use your custom domain for login, or explicitly update the backend session strategy before using such a hostname. The actual frontend domain must be configured on the hosting service and in DNS.

Serve `index.html`, `ngsw.json`, and `ngsw-worker.js` with revalidation (`Cache-Control: no-cache`). Hashed JavaScript and CSS files can use long-lived immutable caching. Keep prior hashed files available during deployment transitions so an already-open app can finish using its version.

After deployment, check a direct `/auth/login` URL, complete login with an email OTP, reload to verify session restoration, and sign out. Confirm browser requests use the HTTPS API and the backend accepts the frontend origin.

App routes are lazy-loaded. Financial amounts are decimal strings; backend calculation and validation remain authoritative. PWA caching includes only application assets, never private API responses.

The dashboard's main card shows the backend's `net_balances` for personal lending and borrowing, separately per currency. Positive net amounts show a plus sign and green “Net to receive”; negative amounts show a minus sign and red “Net to pay.” Zero is neutral and labelled “Balanced overall.” Receivable/payable cards, people balances, and loan activity use the same green/red direction colours. Monthly spending is a separate summary; group balances are separate from the personal net calculation.

Deploy the backend with the `net_balances` response field before this frontend version. No migration is required. If the field is missing from an older API, the net card shows “Not available” while the receivable and payable totals remain visible. Run `npm test` to verify authentication and exact signed-money formatting.

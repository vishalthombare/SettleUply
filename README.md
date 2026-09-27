# SettleUply frontend

Angular 21 standalone application. Use Node 22.12+.

```sh
npm ci
npm start
npm run build
npm run format
```

Visit http://localhost:4200. Configure `src/app/core/environment.ts` for the backend URL. The backend's FRONTEND_URL must match the frontend origin exactly. See the [root README](../README.md) for authentication, database, and no-op provider setup.

App routes are lazy-loaded. Financial amounts are decimal strings; backend calculation and validation remain authoritative. PWA caching includes only application assets, never private API responses.

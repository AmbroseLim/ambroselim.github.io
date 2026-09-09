# Pulse messaging platform

Pulse is a responsive messaging workspace with a React/Vite client, Express API, SQLite persistence, WebSocket updates, and OneSignal Web Push integration.

## OneSignal setup

The web client is initialized with App ID `931eab6d-ae15-4a5c-bbfe-0ebdc75c7ba3` on the configured production origin `ambroselim.github.io`. The required service worker is available at `/OneSignalSDKWorker.js`.

In the OneSignal dashboard, configure the Web platform Site URL to the exact production origin. For local testing, use a separate OneSignal app or add the local origin in the dashboard; the current App ID intentionally does not initialize on `localhost` because OneSignal rejects origins that are not configured for the app.

Web push requires HTTPS in production. iPhone and iPad users on iOS 16.4+ must add the site to their Home Screen before web push can work.

## Run locally

```bash
npm install
npm run dev
```

The web client runs at `http://localhost:5173` and the API runs at `http://localhost:3001`.

## Build

```bash
npm run build
```

## Architecture

- `src/`: responsive messaging client and OneSignal permission/login integration
- `server/`: Express API, SQLite persistence, WebSocket fan-out, and direct Web Push fallback
- `public/OneSignalSDKWorker.js`: OneSignal root service worker

## Reference

- [OneSignal Web SDK setup](https://documentation.onesignal.com/docs/en/web-sdk-setup)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

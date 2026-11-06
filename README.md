# Merchant Portal (Angular)

A merchant-onboarding portal with role-based access (SALES, REVIEWER, ADMIN): an application dashboard, a multi-step wizard with auto-saved drafts, and a detail page with risk history, review controls and masked sensitive data.

- **Angular 22**: standalone components, built-in control flow, signals, `inject()`, **zoneless** (no zone.js), OnPush by default, `rxResource` for server reads; RxJS and Reactive Forms
- **Bootstrap 5.3** via SCSS, no Bootstrap JS (interactive parts are plain Angular with ARIA)
- **Vitest + Angular TestBed** for unit tests; Node's built-in test runner for the mock API
- A dependency-free **mock API** (`mock-api/`) that enforces the same permissions as the UI

## Run it

Used Node 24 (24.15), Angular 22 needs node version 22+; TypeScript 6 is installed by `npm install`.

```bash
npm install

# terminal 1: mock API on :3000. It prints a random demo password on startup.
npm run mock

# terminal 2: Angular dev server on :4200 (proxies /api to :3000)
npm start
```
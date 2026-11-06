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

Sign in at <http://localhost:4200> with the password printed by the mock API and one of these (synthetic) users:

| Role | E-mail | Can do |
| --- | --- | --- |
| SALES | `sam.sales@example.com`, `sara.seller@example.com` | Create/edit own drafts, view own applications |
| REVIEWER | `riley.reviewer@example.com`, `robin.risk@example.com` | View assigned (non-draft) applications, record decisions, reveal sensitive data on those |
| ADMIN | `alex.admin@example.com` | View everything, assign reviewers, reveal sensitive data (not on drafts) |

Useful mock-API switches (set inline, e.g. `ACCESS_TTL_MS=5000 npm run mock`; see `.env.example`):

| Variable | Effect |
| --- | --- |
| `ACCESS_TTL_MS=5000` | Access tokens expire in 5 s, so you can watch the 401 → single refresh → replay flow in the Network tab |
| `FAILURE_RATE=0.3` | 30 % of data requests fail with 503, to exercise error/retry UI and autosave retries |
| `LATENCY_MS=1500` | Slow responses, to see loading states |
| `DEMO_PASSWORD=...` | Choose your own local password instead of the random one |

## Test it

```bash
npm test          # Angular unit tests (Vitest + TestBed)
npm run test:api  # mock API authorization tests (no browser, no Angular)
npm run build     # production build (also validates strict templates)
```

## What is implemented

| Requirement | Where | Notes |
| --- | --- | --- |
| Standalone + control flow + signals + `inject()` | everywhere | No NgModules; `@if/@for/@switch/@let`; zoneless + OnPush (the Angular 22 defaults), so all view state is signals |
| A. Dashboard | `features/applications/dashboard` | Server-side pagination, status filter, debounced search, page size; loading / error + Retry / empty states from one `rxResource` (cancels stale requests, `reload()` for Retry); URL is the source of truth (shareable, back-button safe); role-aware title and actions; live-region announcements |
| B. Multi-step wizard | `features/applications/wizard` | 4 steps, typed Reactive Forms, `FormArray` of owners (1–4), custom + cross-field validators, per-step validation, focus management |
| C. Draft & auto-save | `wizard.ts` | Debounce → ordered `concatMap` queue → retry with backoff for transient errors; failures never touch form state; save status is announced; leave-page guard |
| D. Detail & review | `features/applications/detail` | Sections, risk history timeline, reviewer decision form, admin assignment; review controls are not rendered for SALES |
| F. Sensitive information | `detail/sensitive-field.ts`, `shared/mask*` | Masked by the **server**; role-gated, audit-logged reveal; auto-hides after 30 s; see `docs/SECURITY.md` for CSP |
| Interceptor | `core/auth/auth.interceptor.ts` | Bearer token; on concurrent 401s exactly **one** `POST /api/auth/refresh`, then all requests replay; second 401 ends the session (no loops) |
| Lazy routes + guards | `app.routes.ts`, `applications.routes.ts` | Lazy feature, `canActivate` auth guard, `canMatch` role guard, `canDeactivate` unsaved-changes guard |
| Testing | `*.spec.ts`, `mock-api/api.test.js` | See "Testing strategy" |

Not implemented (optional in the brief): dashboard status counts and Socket.IO live updates. The seams for them are small: counts would be one more endpoint and a `computed`; live updates would push into the dashboard's query stream.

## Angular 22 specifics

- **Zoneless**: `app.config.ts` has no zone provider and the project has no zone.js dependency or polyfill. Change detection is scheduled by signals and template events. Tests therefore alternate `detectChanges()` and `await whenStable()`.
- **OnPush by default**: components declare no `changeDetection`. The one opt-out is `app-text-field` (`ChangeDetectionStrategy.Eager`), because it renders form-control state that is not a signal.
- **`rxResource`** for the dashboard list and the detail page; RxJS stays where time matters (autosave queue, debounce, token refresh).
- Reactive Forms (as the brief requires) rather than Signal Forms.
- **Naming follows the current Angular style guide** (the CLI since v20): no `.component` / `.service` suffixes. `login.ts` exports `Login`, `dashboard.ts` exports `Dashboard`, `auth.ts` exports `Auth`. Roles that a name alone doesn't convey keep a marker (`AuthStore`, `ApplicationsApi`, `MaskPipe`, `auth.guards.ts`, `auth.interceptor.ts`).

## Project layout

```
src/app/
  core/       auth store/service/interceptor/guards, models, error mapping
  shared/     text-field (ControlValueAccessor), validators + pure rules, masking, status badge
  features/
    auth/          login
    applications/  api client, routes (lazy), dashboard/, wizard/, detail/
    errors/        forbidden + not-found pages (one component per file)
mock-api/     dependency-free Node API (server.js), synthetic seed, authorization tests
docs/         DESIGN_DECISIONS.md, SECURITY.md
```

## Testing strategy

- **Interceptor** (the riskiest logic): attaches token only to `/api/` calls; three concurrent 401s → one refresh → three replays; a late 401 reuses the new token; refresh failure ends the session once and fails every waiter; a replayed 401 does not loop. `HttpTestingController.verify()` fails any test that leaves a request unhandled.
- **Guards**: anonymous, each role, redirects as `UrlTree`s.
- **Dashboard**: loading, rows, error → Retry → recovery, empty, URL → server query, hostile query-string values sanitised, role-specific UI.
- **Detail**: review controls absent for SALES, decision form only when the server grants `canDecide`, assignment only for `canAssign`, permissions come from the server not the role label, error → Retry.
- **Wizard / autosave** (fake timers): debounce coalescing, create-then-update, failure keeps the form and retry recovers, transient retry with backoff, "typed while saving" is not reported as saved, validators and step gating.
- **Sensitive field**: masked by default, reveal calls the API, auto-hide timer, no reveal control without permission, API errors surfaced.
- **Pure rules** (`validation-rules.ts`) are tested without Angular.
- **Mock API**: every permission rule is tested by calling the API directly (no UI), including token rotation and reuse detection.

## Assessment automatic-fail conditions: how they are handled

| Condition | Handling |
| --- | --- |
| Committed secrets / credentials | None committed. The demo password is generated randomly on each mock-API start (or comes from `DEMO_PASSWORD`). Tests generate their own. `.env*` is git-ignored except `.env.example`, which contains no secrets. Tokens are opaque random strings held in memory. |
| Authorization / permission bypass | Rules live in the API (`canView`, `canReveal`, `canDecide`, `canAssign`) and are tested directly. The UI renders from server-provided `permissions`, but hiding a control is never the only protection. Unknown ids return 404 (no existence leak). Unknown JSON keys are dropped (no mass assignment of `status`, owner, reviewer). |
| Real personal / customer / card data | None. Names come from word lists, e-mails use `example.com`, routing numbers start `0000` (never assigned to a real bank), and there is no card number anywhere in the app or data. |
| Plagiarised work | Original code written for this brief; AI assistance is disclosed below. |
| Cannot explain own code | `docs/DESIGN_DECISIONS.md` records the reasoning behind each non-obvious choice. |

## AI assistance disclosure

> Replace this paragraph with an accurate account before submitting.
>
> An AI coding assistant (Claude) was used to draft parts of the code, tests and documentation. I reviewed and ran everything myself: `npm run build`, `npm test`, `npm run test:api`, and manual walkthroughs of each role (login, concurrent-401 refresh using `ACCESS_TTL_MS=5000`, autosave under `FAILURE_RATE=0.3`, reveal permissions). I can explain every part of the code.

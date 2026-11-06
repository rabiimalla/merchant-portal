# Design decisions: what, and why this way

## 1. Signals or RxJS? A rule, not a preference

| Use | For | Because |
| --- | --- | --- |
| **Signals** | Synchronous state that templates read: `AuthStore.user`, UI flags (`step`, `loading`, `submitting`), derived values (`computed` for `totalPages`, nav links, `canCreate`) | Always has a value, reads are glitch-free, templates and `computed` track dependencies automatically, no subscriptions to clean up |
| **RxJS** | Anything about *time or cancellation*: debounce, `switchMap`/`concatMap`, retry with backoff, request sharing, `HttpClient` | Operators express these declaratively; signals have no equivalent of "wait 1.2 s of silence" or "cancel the previous request" |
| **Bridge** | `toObservable` / `toSignal` at the boundary | Keep each tool in its lane and convert exactly once |

Applied:

- **Dashboard.** URL params arrive as signal inputs (`withComponentInputBinding`). They feed an `rxResource`: when any input changes, the previous request is cancelled and a new one starts, so a slow page 2 can never overwrite a newer page 3. The resource exposes loading / error / value and `reload()` (the Retry button), so there is no hand-written state machine to get wrong.
- **Search box.** `FormControl.valueChanges` + `debounceTime(300)` + `distinctUntilChanged`: this is time-based, so RxJS. The result is written to the URL, which feeds the signal inputs. One source of truth.
- **Autosave.** Pure RxJS (see §3). Its *status* is exposed as a signal because the template only needs the latest value.
- **Access token** is a plain private field, not a signal: nothing renders it, so reactivity would be noise.
- **`linkedSignal`** in the assignment panel: the selected reviewer follows the server value after reloads, but is writable while the admin chooses.
- **`rxResource` vs `httpResource` vs a manual pipeline.** Resources are stable in Angular 22, so reads use `rxResource`: it removes the `switchMap`/`toSignal`/retry-counter plumbing. I chose `rxResource` over `httpResource` because calls go through one typed `ApplicationsApi` (single place that knows URLs, trivial to mock). Resources do not replace RxJS where *time* matters: autosave (ordered queue, backoff), the debounced search box, and the single-flight token refresh stay RxJS. Gotcha handled: `value()` throws while a resource is in the error state, so the template checks `error()` first, and `HttpErrorResponse` is not an `Error` subclass, so `httpErrorMessage` also unwraps `Error.cause`.

## 2. State management: no NgRx

State is local to each feature component: dashboard, detail and wizard each own a small signal/stream. Nothing is shared between screens except the session (`AuthStore`). Adding a global store here would add indirection without removing any duplication. The trigger to introduce one would be cross-screen shared entities (e.g. a cached application list feeding both a dashboard and a side panel) or optimistic updates spanning screens; `SignalStore` from NgRx would be my pick then.

## 3. Autosave: operator choice matters

```
form.valueChanges → filter(!hydrating) → mark dirty → debounceTime(1200)
                                                        ↘
explicit "Retry"/pre-submit flush  ──────────────────→ merge → concatMap(persist) 
persist(): create (POST) or update (PUT) → retry(2, backoff, transient only) → catchError → of(false)
```

- **`concatMap`, not `switchMap`/`exhaustMap`.** `switchMap` cancels the HTTP call client-side, but the server may already have processed it, so the client's view and the server's can diverge, and cancelling the *first* `POST` could create a draft the client never learns the id of (then the next save creates a second one). `exhaustMap` would drop the newest edits made during a save. `concatMap` runs saves strictly in order, never drops one, and each save reads the *current* form value when it starts, so queued saves collapse into "send the latest".
- **`catchError` inside the inner stream** (returning `of(false)`), so one failure doesn't terminate the outer pipeline. Otherwise autosave would silently stop for the rest of the session.
- **Only transient errors are retried** (network / 5xx). A 4xx would fail identically; retrying only delays the message.
- **Form state is never touched on failure.** The form is the source of truth, not the server response. The user sees "Your answers are still here" and a Retry button.
- **"Saved" is only claimed if nothing changed during the save** (a change counter compares before/after), otherwise it stays "dirty" and the next queued save runs.
- **Submit flushes through the same queue**, so a pending autosave and the submit cannot race and double-create the draft; if the flush fails, nothing is submitted and the user is told.
- **Hydration guard.** Patching an existing draft into the form emits `valueChanges`; a flag stops that from triggering a pointless save.
- **No draft copy in browser storage.** A local backup would protect against a closed tab, but it would put tax IDs and account numbers into `localStorage`, readable by any XSS. A `canDeactivate` guard plus the unsaved-changes state covers in-app navigation instead. (A `beforeunload` prompt is the natural next step.)

## 4. The 401 → refresh → replay interceptor

Requirement: *several concurrent requests that all get 401 must trigger exactly one refresh.*

- `Auth` holds one in-flight refresh observable: `post(...).pipe(tap(store), finalize(clear), shareReplay({bufferSize:1, refCount:false}))`. Every concurrent 401 joins it instead of starting its own.
- **Why it matters beyond efficiency:** refresh tokens *rotate*. A second concurrent refresh would present an already-used token, which the server treats as theft and revokes the session.
- **Late arrivals.** A request sent with the old token whose 401 arrives *after* the refresh finished: the in-flight slot is empty, so the service compares the failed request's token with the store's current token; if they differ, it reuses the new one instead of refreshing again.
- **"Once" is structural.** The replayed request is not wrapped in the refresh `catchError`. A second 401 ends the session; it cannot loop.
- **Auth endpoints are exempt** (`/api/auth/login|refresh|logout`): no bearer token, no refresh-on-401 (that would recurse).
- **Only `/api/` URLs get the token**, so it can never be sent to another origin.
- **Where tokens live:** access token in memory; refresh token in an `HttpOnly; SameSite=Strict` cookie scoped to `/api/auth`, invisible to JavaScript. On reload an app initializer calls `/auth/refresh` once to restore the session before the first render, so guards never flash the login page at a signed-in user. Refresh/logout also require a custom header (CSRF defence in depth).

## 5. Permissions: three layers, only one of which is security

1. **UI**: links and buttons a role cannot use are not rendered; the UI renders from server-provided `permissions` (`canEdit`, `canReveal`, `canDecide`, `canAssign`) rather than re-deriving rules, so the rules live in exactly one place.
2. **Router**: `canMatch` role guard (lazy chunk never downloads for the wrong role) and a `UrlTree` redirect. Returning `false` from `canMatch` would make the router fall through to `:id`, so `/applications/new` would try to load an application called "new".
3. **API**: the only real enforcement. Tested directly without the UI. Unknown/forbidden ids return 404 so ids cannot be probed.

Interview one-liner: *anything in the browser is a hint; the server decides.*

## 6. Sensitive data

- **The server masks by default**; the browser never receives tax IDs, account numbers or national IDs for a submitted application unless it asks through `POST .../reveal`, which is role-checked (admin, or the assigned reviewer; never on drafts) and audit-logged.
- **Client masking is presentation only** (screen sharing, shoulder-surfing). It uses a fixed-width mask so the length isn't leaked.
- A revealed value lives only in one component's memory, **auto-hides after 30 s**, is dropped on reload/destroy, is never cached, and is rendered by interpolation (Angular escapes it).
- **Trade-off accepted:** the SALES owner of a still-editable draft receives their own raw values, because they typed them and must be able to edit them. Once the application is submitted, they are masked for the owner as well. The alternative, "write-only" fields that show `••••1234, leave blank to keep`, is stricter but adds a merge-on-save contract; I'd choose it for real card or bank data.
- Inputs for sensitive data use `type=password` with a Show/Hide toggle and `autocomplete="new-password"`, so browsers and password managers don't store them.

## 7. Forms

- **Typed forms** via `NonNullableFormBuilder`; no `any`, no `null` surprises.
- **Validation rules are pure functions** (`validation-rules.ts`: EIN format, ABA routing checksum, account length, phone, http(s)-only URL, ownership sum with float tolerance), wrapped as `ValidatorFn`s. They are trivially unit-testable and shareable with a backend. The mock server re-implements them because the server never trusts the client.
- **Cross-field validators** at the right level: ownership must total 100 % (on the `FormArray`), account-number confirmation (on the group).
- **`app-text-field`** is a `ControlValueAccessor` that wires label ↔ input, `aria-invalid`, `aria-describedby`, and error text announced with `role="alert"`; every field gets the same accessibility for free.
- **Wizard UX:** each step validates before moving on; invalid → fields marked touched and focus jumps to the first invalid control; each step's heading takes focus on change; later steps can't be jumped to, earlier ones can.

## 8. Dashboard

- **Server-side everything** (page, size, status, search); the client never holds the full list.
- **URL as state:** reload, back button and shared links work; garbage in the query string is sanitised through input transforms (`page=-5`, `pageSize=9999`, `status=<script>` all fall back to defaults; tested).
- **Error handling comes with the resource**: `error()` drives the alert and the Retry button calls `reload()`, which re-runs the same query. Stale-data rule: a parameter change clears the value (loading state), while a retry keeps nothing from the failed attempt.
- **Accessibility:** semantic table with caption and `scope`, polite live region announcing results, labelled controls, `aria-current` on pagination, visible focus, skip link, reduced-motion support, responsive columns hidden at small widths.

## 9. Things I deliberately did not do (and why)

- **Optional extras** (status counts, Socket.IO): the brief says skip unless the core is complete, and a thorough core was a better use of the time box.
- **Zoneless is on (the Angular 22 default).** There is no zone.js, so change detection runs only when something *tells* Angular: a signal changes, a template event handler fires, `markForCheck`, or the async pipe. Consequence for the code: every piece of view state is a signal (checked: the only non-signal mutable field is a private timer handle that is never rendered), and there are no async validators or timers that mutate plain fields. Tests changed too: no `fakeAsync`; use `await fixture.whenStable()` and Vitest fake timers.
- **OnPush is the default in Angular 22**, so components declare nothing. `app-text-field` opts out with `ChangeDetectionStrategy.Eager` because it renders control state (touched/invalid) that is not a signal, so when a parent calls `markAllAsTouched()` inside a click handler (which schedules a change-detection pass) the field must be re-checked. Cleaner long-term fix: mirror the control status into a signal. Signal Forms (stable in 22) would remove the issue, but the brief asks for Reactive Forms.
- **UI library JS (ng-bootstrap/Material):** not needed; the few interactive widgets are small and a11y-reviewed by hand.
- **Role-specific dashboards/analytics:** out of scope.

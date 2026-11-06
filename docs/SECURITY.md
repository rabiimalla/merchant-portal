# Security notes

## Threat model in one paragraph

The sensitive assets are tax IDs, owner national IDs and bank account numbers, plus the session. The realistic threats for a browser SPA are (1) **XSS** that runs script in the page, (2) **CSRF** against cookie-authenticated endpoints, (3) **privilege escalation** by calling the API directly or tampering with the UI, and (4) **over-exposure** (screen sharing, logs, caches, storage).

| Threat | Mitigation in this repo |
| --- | --- |
| XSS | Angular's default escaping and sanitising; **no** `innerHTML`, `bypassSecurityTrust*`, `eval`, or `document.write` anywhere (checked by search); CSP (below); tokens not in `localStorage` |
| Token theft | Access token in memory only; refresh token is `HttpOnly; SameSite=Strict`, scoped to `/api/auth`, rotated on each use; reuse of a rotated token revokes the user's refresh tokens |
| CSRF | `SameSite=Strict` cookie + required custom header on `/auth/refresh` and `/auth/logout` |
| Privilege escalation | Authorization enforced by the API on every request and tested without the UI; 404 for ids the caller cannot see; unknown JSON keys dropped (no mass assignment) |
| Over-exposure | Server-side masking; audited reveal; auto-hide after 30 s; `Cache-Control: no-store`; no sensitive data in URLs; no draft backups in browser storage |
| Open redirect | `returnUrl` only accepted if it is a same-app path (`/x`, not `//x` or containing `\`) |
| Token leakage | The interceptor only attaches the bearer token to `/api/` URLs |

## Content Security Policy (CSP)

**What it is.** A response header that tells the browser which sources of script, styles, images, connections and frames it may use for this page. It is a *second line of defence*: if an attacker finds a way to inject markup (an XSS bug in our code, a compromised dependency, a browser-extension quirk), CSP can stop the injected code from executing and from sending data out.

**How it protects this app specifically**

- `script-src 'self'` (plus hashes/nonces) blocks inline `<script>` and `javascript:` handlers an attacker injects, and scripts from other origins.
- `connect-src 'self'` stops injected code from `fetch`-ing tax IDs to an attacker's server (exfiltration), even if it did run.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` close off plugin, `<base>`-hijack and form-redirect tricks.
- `frame-ancestors 'none'` prevents clickjacking of the reveal buttons.

**What it does not do.** It does not replace output escaping, and it cannot protect data the page legitimately reads. That is why the sensitive data is also masked by the server and gated per role: even a successful script injection can't read what the API never sent.

**Angular specifics**

- The production build sets `"security": { "autoCsp": true }`, which hashes the inline script Angular's build emits, so a strict `script-src` works **without** `'unsafe-inline'`. After `npm run build`, open `dist/.../browser/index.html` to see what was generated and mirror it in your header.
- Component styles are injected as `<style>` elements, so `style-src` needs either `'unsafe-inline'` (pragmatic; styles are far lower risk than scripts) or a per-response **nonce**: set `ngCspNonce="<nonce>"` on `<app-root>` and send the same nonce in the header. Nonces require the HTML to be served dynamically.
- Optional hardening: **Trusted Types** (`require-trusted-types-for 'script'; trusted-types angular angular#bundler`), which Angular supports.
- CSP is delivered as an **HTTP header** by whatever serves the app, not as a `<meta>` tag, because meta tags cannot express `frame-ancestors` or reporting and are easier to override. See the comment in `src/index.html`.

**Example header (adjust the API origin and hashes)**

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'sha256-<hash from build output>';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none'
```

nginx:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-REPLACE'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
```

Roll out with `Content-Security-Policy-Report-Only` first, watch for violations, then enforce.

## Known limitations (honest list)

- The mock API is in-memory and single-process; real deployments need persistent session storage, rate limiting and lockout on `/auth/login`, TLS (and the `Secure` cookie flag: `COOKIE_SECURE=1`), and a real identity provider.
- `Secure` is off by default so the cookie works on `http://localhost`.
- The unsaved-changes guard covers in-app navigation; a `beforeunload` handler would cover closing the tab.
- Owners see raw values on their own editable draft (see `DESIGN_DECISIONS.md` §6).

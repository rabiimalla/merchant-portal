'use strict';
/**
 * Mock API for the merchant portal. Plain Node (no dependencies), in-memory state.
 *
 * Why it enforces permissions itself: the Angular UI hides controls by role, but that is only UX.
 * Every rule below is enforced here too, which is what "no authorization bypass" really means
 * (and the tests in api.test.js prove it by calling the API directly, without any UI).
 *
 * Security choices worth knowing about:
 *  - Access token: short-lived opaque string, returned in the JSON body, kept in memory by the SPA.
 *  - Refresh token: rotated on every use, delivered ONLY as an HttpOnly + SameSite=Strict cookie
 *    scoped to /api/auth, so JavaScript (and therefore XSS) can never read it.
 *  - Re-use of an already-rotated refresh token revokes that user's refresh tokens (theft signal).
 *  - Cookie-authenticated endpoints (refresh/logout) also require a custom request header,
 *    which a cross-site form or <img> cannot send (CSRF defence in depth).
 *  - Sensitive fields are masked by the SERVER by default; "reveal" is a separate, audited call.
 *  - Unknown JSON keys are dropped (no mass assignment of status, ownership, etc.).
 *  - No credentials are stored in the repo: the demo password comes from DEMO_PASSWORD or is
 *    randomly generated on every start and printed to the console.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { USERS, buildSeed } = require('./seed');

const STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'merchant-portal';
const REFRESH_COOKIE = 'rt';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const token = () => crypto.randomBytes(24).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const maskValue = (v) => {
  const s = String(v ?? '');
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
};

function maskData(data) {
  const copy = structuredClone(data);
  copy.business.taxId = maskValue(copy.business.taxId);
  copy.banking.accountNumber = maskValue(copy.banking.accountNumber);
  copy.owners = copy.owners.map((o) => ({ ...o, nationalId: maskValue(o.nationalId) }));
  return copy;
}

// ---- validation (mirrors the client rules; the server never trusts the client) ----
const isRouting = (v) => {
  if (!/^\d{9}$/.test(v)) return false;
  const d = v.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
};

function validateForSubmit(d) {
  const e = {};
  const b = d.business;
  const req = (key, val) => { if (!String(val ?? '').trim()) e[key] = 'Required'; };
  req('business.legalName', b.legalName);
  req('business.industry', b.industry);
  req('business.line1', b.line1);
  req('business.city', b.city);
  req('business.postalCode', b.postalCode);
  if (!/^\d{2}-\d{7}$/.test(b.taxId)) e['business.taxId'] = 'Tax ID must look like 12-3456789';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) e['business.email'] = 'Invalid e-mail';
  if ((b.phone.match(/\d/g) || []).length < 7) e['business.phone'] = 'Invalid phone number';
  if (d.owners.length < 1 || d.owners.length > 4) e['owners'] = 'Between 1 and 4 owners required';
  let total = 0;
  d.owners.forEach((o, i) => {
    req(`owners.${i}.fullName`, o.fullName);
    req(`owners.${i}.nationalId`, o.nationalId);
    if (!(o.ownershipPercent > 0 && o.ownershipPercent <= 100)) e[`owners.${i}.ownershipPercent`] = 'Must be between 1 and 100';
    total += o.ownershipPercent;
  });
  if (d.owners.length && Math.abs(total - 100) > 0.001) e['owners'] = 'Ownership must add up to 100%';
  req('banking.bankName', d.banking.bankName);
  if (!isRouting(d.banking.routingNumber)) e['banking.routingNumber'] = 'Invalid routing number';
  if (!/^\d{6,17}$/.test(d.banking.accountNumber)) e['banking.accountNumber'] = 'Account number must be 6-17 digits';
  return e;
}

/** Whitelist-copy of a draft body: unknown keys are dropped, strings are length-capped. */
function sanitizeDraft(body) {
  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const b = body?.business ?? {};
  const bank = body?.banking ?? {};
  const owners = Array.isArray(body?.owners) ? body.owners.slice(0, 4) : [];
  return {
    business: {
      legalName: str(b.legalName, 120), dba: str(b.dba, 120), taxId: str(b.taxId, 20), industry: str(b.industry, 60),
      website: str(b.website, 200), phone: str(b.phone, 25), email: str(b.email, 120),
      line1: str(b.line1, 120), city: str(b.city, 80), postalCode: str(b.postalCode, 12),
    },
    owners: owners.map((o) => ({
      fullName: str(o?.fullName, 120), title: str(o?.title, 80), nationalId: str(o?.nationalId, 20), email: str(o?.email, 120),
      ownershipPercent: Number.isFinite(Number(o?.ownershipPercent)) ? Math.min(100, Math.max(0, Number(o.ownershipPercent))) : 0,
    })),
    banking: { bankName: str(bank.bankName, 80), routingNumber: str(bank.routingNumber, 9), accountNumber: str(bank.accountNumber, 17) },
  };
}

// ---- authorization rules: the single source of truth ----
const canView = (u, a) => {
  if (u.role === 'ADMIN') return true;
  if (u.role === 'SALES') return a.createdBy === u.id;
  if (u.role === 'REVIEWER') return a.assignedReviewerId === u.id && a.status !== 'DRAFT';
  return false;
};
const isOwnerSales = (u, a) => u.role === 'SALES' && a.createdBy === u.id;
const canReveal = (u, a) => a.status !== 'DRAFT' && (u.role === 'ADMIN' || (u.role === 'REVIEWER' && a.assignedReviewerId === u.id));
const permissionsFor = (u, a) => ({
  canEdit: isOwnerSales(u, a) && a.status === 'DRAFT',
  canReveal: canReveal(u, a),
  canDecide: u.role === 'REVIEWER' && a.assignedReviewerId === u.id && a.status === 'IN_REVIEW',
  canAssign: u.role === 'ADMIN' && (a.status === 'SUBMITTED' || a.status === 'IN_REVIEW'),
});

function createApp(opts = {}) {
  const cfg = {
    accessTtlMs: opts.accessTtlMs ?? num(process.env.ACCESS_TTL_MS, 120_000),
    refreshTtlMs: opts.refreshTtlMs ?? num(process.env.REFRESH_TTL_MS, 8 * 3_600_000),
    latencyMs: opts.latencyMs ?? num(process.env.LATENCY_MS, 250),
    failureRate: opts.failureRate ?? num(process.env.FAILURE_RATE, 0),
    cookieSecure: opts.cookieSecure ?? process.env.COOKIE_SECURE === '1',
    demoPassword: opts.demoPassword ?? process.env.DEMO_PASSWORD ?? crypto.randomBytes(9).toString('base64url'),
  };
  const passwordDigest = sha256(cfg.demoPassword);
  const store = {
    apps: buildSeed(),
    accessTokens: new Map(), // token -> { userId, exp }
    refreshTokens: new Map(), // token -> { userId, exp }
    usedRefreshTokens: new Map(), // rotated token -> { userId }
    audit: [], // reveal events
    seq: 1000,
    refreshCalls: 0, // exposed for tests
  };
  const userById = (id) => USERS.find((u) => u.id === id);
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

  // ---- presentation ----
  const summary = (a) => ({
    id: a.id,
    legalName: a.data.business.legalName,
    status: a.status,
    createdByName: userById(a.createdBy)?.name ?? 'Unknown',
    assignedReviewerName: a.assignedReviewerId ? userById(a.assignedReviewerId)?.name ?? null : null,
    updatedAt: a.updatedAt,
  });
  const detail = (u, a) => {
    const permissions = permissionsFor(u, a);
    const raw = permissions.canEdit; // owners may see what they typed into their own draft
    return {
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      createdByName: userById(a.createdBy)?.name ?? 'Unknown',
      assignedReviewer: a.assignedReviewerId ? { id: a.assignedReviewerId, name: userById(a.assignedReviewerId)?.name } : null,
      data: raw ? a.data : maskData(a.data),
      sensitiveMasked: !raw,
      riskHistory: a.riskHistory,
      permissions,
    };
  };

  // ---- sessions ----
  function issueSession(res, user) {
    const accessToken = token();
    const refreshToken = token();
    store.accessTokens.set(accessToken, { userId: user.id, exp: Date.now() + cfg.accessTtlMs });
    store.refreshTokens.set(refreshToken, { userId: user.id, exp: Date.now() + cfg.refreshTtlMs });
    res.setHeader(
      'Set-Cookie',
      `${REFRESH_COOKIE}=${refreshToken}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=${Math.floor(cfg.refreshTtlMs / 1000)}${cfg.cookieSecure ? '; Secure' : ''}`,
    );
    return { accessToken, user: publicUser(user) };
  }
  const clearCookie = (res) =>
    res.setHeader('Set-Cookie', `${REFRESH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0${cfg.cookieSecure ? '; Secure' : ''}`);
  const readCookie = (req, name) => {
    const m = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return m ? m.slice(name.length + 1) : null;
  };
  const requireCsrfHeader = (req) => {
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new HttpError(403, 'Missing or invalid CSRF header');
  };
  function authenticate(req) {
    const h = req.headers.authorization ?? '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : null;
    const s = t ? store.accessTokens.get(t) : null;
    if (!s) throw new HttpError(401, 'Unauthenticated');
    if (s.exp <= Date.now()) {
      store.accessTokens.delete(t);
      throw new HttpError(401, 'Access token expired');
    }
    return userById(s.userId);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 100_000) throw new HttpError(413, 'Payload too large');
      chunks.push(c);
    }
    if (!size) return {};
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
    // Handlers read fields off the body; null, strings and arrays would crash them (500).
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'JSON body must be an object');
    }
    return parsed;
  }

  const findApp = (user, id) => {
    const a = store.apps.find((x) => x.id === id);
    // 404 (not 403) for anything the caller may not see: do not confirm that ids exist.
    if (!a || !canView(user, a)) throw new HttpError(404, 'Application not found');
    return a;
  };

  // ---- route table ----
  const routes = [];
  const add = (method, pattern, handler, { auth = true } = {}) =>
    routes.push({ method, regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, auth });

  add('POST', '/api/auth/login', async ({ body, res }) => {
    const user = USERS.find((u) => u.email === String(body.email ?? '').trim().toLowerCase());
    const passwordOk = crypto.timingSafeEqual(sha256(body.password ?? ''), passwordDigest);
    if (!user || !passwordOk) throw new HttpError(401, 'Invalid email or password');
    return [200, issueSession(res, user)];
  }, { auth: false });

  add('POST', '/api/auth/refresh', async ({ req, res }) => {
    requireCsrfHeader(req);
    store.refreshCalls++;
    const rt = readCookie(req, REFRESH_COOKIE);
    const entry = rt ? store.refreshTokens.get(rt) : null;
    if (!entry) {
      const reused = rt ? store.usedRefreshTokens.get(rt) : null;
      if (reused) {
        for (const [k, v] of store.refreshTokens) if (v.userId === reused.userId) store.refreshTokens.delete(k);
      }
      clearCookie(res);
      throw new HttpError(401, 'Invalid refresh token');
    }
    store.refreshTokens.delete(rt);
    store.usedRefreshTokens.set(rt, { userId: entry.userId });
    if (entry.exp <= Date.now()) {
      clearCookie(res);
      throw new HttpError(401, 'Refresh token expired');
    }
    return [200, issueSession(res, userById(entry.userId))];
  }, { auth: false });

  add('POST', '/api/auth/logout', async ({ req, res }) => {
    requireCsrfHeader(req);
    const rt = readCookie(req, REFRESH_COOKIE);
    if (rt) store.refreshTokens.delete(rt);
    const h = req.headers.authorization ?? '';
    if (h.startsWith('Bearer ')) store.accessTokens.delete(h.slice(7));
    clearCookie(res);
    return [204, null];
  }, { auth: false });

  add('GET', '/api/me', async ({ user }) => [200, publicUser(user)]);

  add('GET', '/api/reviewers', async ({ user }) => {
    if (user.role !== 'ADMIN') throw new HttpError(403, 'Forbidden');
    return [200, USERS.filter((u) => u.role === 'REVIEWER').map((u) => ({ id: u.id, name: u.name }))];
  });

  add('GET', '/api/applications', async ({ user, url }) => {
    const p = url.searchParams;
    const page = Math.max(1, Math.trunc(num(p.get('page'), 1)));
    const pageSize = Math.min(50, Math.max(1, Math.trunc(num(p.get('pageSize'), 10))));
    const status = STATUSES.includes(p.get('status')) ? p.get('status') : '';
    const q = (p.get('q') ?? '').trim().toLowerCase().slice(0, 100);
    const visible = store.apps
      .filter((a) => canView(user, a))
      .filter((a) => !status || a.status === status)
      .filter((a) => !q || a.data.business.legalName.toLowerCase().includes(q) || a.id.includes(q))
      .sort((x, y) => (y.updatedAt === x.updatedAt ? y.id.localeCompare(x.id) : y.updatedAt.localeCompare(x.updatedAt)));
    const items = visible.slice((page - 1) * pageSize, page * pageSize).map(summary);
    return [200, { items, total: visible.length, page, pageSize }];
  });

  add('POST', '/api/applications', async ({ user, body }) => {
    if (user.role !== 'SALES') throw new HttpError(403, 'Only sales users can create applications');
    const now = new Date().toISOString();
    const a = {
      id: `app-${++store.seq}`, status: 'DRAFT', createdBy: user.id, assignedReviewerId: null,
      createdAt: now, updatedAt: now, data: sanitizeDraft(body), riskHistory: [],
    };
    store.apps.push(a);
    return [201, detail(user, a)];
  });

  add('GET', '/api/applications/:id', async ({ user, params }) => [200, detail(user, findApp(user, params.id))]);

  add('PUT', '/api/applications/:id/draft', async ({ user, params, body }) => {
    const a = findApp(user, params.id);
    if (!isOwnerSales(user, a)) throw new HttpError(403, 'Only the owning sales user can edit this application');
    if (a.status !== 'DRAFT') throw new HttpError(409, 'Only drafts can be edited');
    a.data = sanitizeDraft(body);
    a.updatedAt = new Date().toISOString();
    return [200, { id: a.id, updatedAt: a.updatedAt }];
  });

  add('POST', '/api/applications/:id/submit', async ({ user, params }) => {
    const a = findApp(user, params.id);
    if (!isOwnerSales(user, a)) throw new HttpError(403, 'Only the owning sales user can submit this application');
    if (a.status !== 'DRAFT') throw new HttpError(409, 'Application was already submitted');
    const errors = validateForSubmit(a.data);
    if (Object.keys(errors).length) throw new HttpError(422, 'Application is incomplete or invalid', errors);
    a.status = 'SUBMITTED';
    a.updatedAt = new Date().toISOString();
    a.riskHistory.push({ id: `h-${++store.seq}`, at: a.updatedAt, byName: user.name, type: 'SUBMISSION', note: 'Application submitted' });
    return [200, detail(user, a)];
  });

  add('PUT', '/api/applications/:id/assignment', async ({ user, params, body }) => {
    if (user.role !== 'ADMIN') throw new HttpError(403, 'Only admins can manage assignments');
    const a = findApp(user, params.id);
    if (a.status !== 'SUBMITTED' && a.status !== 'IN_REVIEW') throw new HttpError(409, 'Application cannot be (re)assigned in its current status');
    const reviewer = USERS.find((u) => u.id === body.reviewerId && u.role === 'REVIEWER');
    if (!reviewer) throw new HttpError(422, 'reviewerId must be a reviewer');
    a.assignedReviewerId = reviewer.id;
    a.status = 'IN_REVIEW';
    a.updatedAt = new Date().toISOString();
    a.riskHistory.push({ id: `h-${++store.seq}`, at: a.updatedAt, byName: user.name, type: 'ASSIGNMENT', note: `Assigned to ${reviewer.name}` });
    return [200, detail(user, a)];
  });

  add('POST', '/api/applications/:id/decision', async ({ user, params, body }) => {
    const a = findApp(user, params.id);
    if (user.role !== 'REVIEWER' || a.assignedReviewerId !== user.id) throw new HttpError(403, 'Only the assigned reviewer can decide');
    if (a.status !== 'IN_REVIEW') throw new HttpError(409, 'Application is not in review');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!['APPROVED', 'REJECTED'].includes(body.decision) || !RISK_LEVELS.includes(body.riskLevel) || note.length < 10 || note.length > 1000) {
      throw new HttpError(422, 'decision, riskLevel and a note of 10-1000 characters are required');
    }
    a.status = body.decision;
    a.updatedAt = new Date().toISOString();
    a.riskHistory.push({ id: `h-${++store.seq}`, at: a.updatedAt, byName: user.name, type: 'DECISION', riskLevel: body.riskLevel, note });
    return [200, detail(user, a)];
  });

  add('POST', '/api/applications/:id/reveal', async ({ user, params, body }) => {
    const a = findApp(user, params.id);
    if (!canReveal(user, a)) throw new HttpError(403, 'You are not allowed to reveal sensitive data on this application');
    const index = Number.isInteger(body.index) ? body.index : 0;
    let value;
    if (body.field === 'taxId') value = a.data.business.taxId;
    else if (body.field === 'accountNumber') value = a.data.banking.accountNumber;
    else if (body.field === 'ownerNationalId') value = a.data.owners[index]?.nationalId;
    if (value === undefined) throw new HttpError(422, 'Unknown field');
    store.audit.push({ at: new Date().toISOString(), userId: user.id, applicationId: a.id, field: body.field, index });
    return [200, { value }];
  });

  // ---- server ----
  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      if (payload === null || payload === undefined) return res.end();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const isAuthRoute = path.startsWith('/api/auth/');
      if (cfg.latencyMs) await sleep(cfg.latencyMs);
      if (!isAuthRoute && cfg.failureRate > 0 && Math.random() < cfg.failureRate) throw new HttpError(503, 'Simulated outage');

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.regex.exec(path);
        if (!m) continue;
        const user = r.auth ? authenticate(req) : null;
        const body = req.method === 'GET' ? {} : await readBody(req);
        const [status, payload] = await r.handler({ req, res, url, user, params: m.groups ?? {}, body });
        return send(status, payload);
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { message: err.message, errors: err.details });
      console.error(err);
      return send(500, { message: 'Internal error' });
    }
  });

  return { server, store, cfg };
}

module.exports = { createApp };

if (require.main === module) {
  const { server, cfg } = createApp();
  const port = num(process.env.PORT, 3000);
  server.listen(port, () => {
    console.log(`Mock API listening on http://localhost:${port}`);
    console.log(`Demo password for all seeded users: ${cfg.demoPassword}`);
    console.log('Users: sam.sales@example.com, sara.seller@example.com, riley.reviewer@example.com, robin.risk@example.com, alex.admin@example.com');
  });
}

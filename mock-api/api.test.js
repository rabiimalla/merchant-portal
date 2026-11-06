'use strict';
/**
 * Authorization tests that talk to the API directly (no UI involved).
 * Run with: npm run test:api
 *
 * The password is generated per run, so nothing credential-like is committed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('./server');

const PASSWORD = crypto.randomBytes(12).toString('hex');
const CSRF = { 'x-requested-with': 'merchant-portal' };

async function start(t, opts = {}) {
  const app = createApp({ latencyMs: 0, demoPassword: PASSWORD, ...opts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { app.server.closeAllConnections(); app.server.close(() => r()); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const login = async (email) => {
    const r = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { token: r.json.accessToken, cookie, user: r.json.user, setCookie: r.headers.get('set-cookie') };
  };
  return { ...app, call, login };
}

const emails = {
  sam: 'sam.sales@example.com',
  sara: 'sara.seller@example.com',
  riley: 'riley.reviewer@example.com',
  robin: 'robin.risk@example.com',
  alex: 'alex.admin@example.com',
};

test('login rejects wrong password and never reveals which part was wrong', async (t) => {
  const api = await start(t);
  const bad = await api.call('POST', '/api/auth/login', { body: { email: emails.sam, password: 'nope' } });
  const unknown = await api.call('POST', '/api/auth/login', { body: { email: 'x@example.com', password: PASSWORD } });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(bad.json.message, unknown.json.message);
});

test('refresh cookie is HttpOnly + SameSite=Strict and the refresh token is not in the JSON body', async (t) => {
  const api = await start(t);
  const s = await api.login(emails.sam);
  assert.match(s.setCookie, /HttpOnly/);
  assert.match(s.setCookie, /SameSite=Strict/);
  assert.equal(JSON.stringify(s).includes('refreshToken'), false);
});

test('requests without a token get 401', async (t) => {
  const api = await start(t);
  assert.equal((await api.call('GET', '/api/applications')).status, 401);
});

test('SALES only sees own applications and gets 404 for someone else\'s', async (t) => {
  const api = await start(t);
  const sam = await api.login(emails.sam);
  const sara = await api.login(emails.sara);
  const list = await api.call('GET', '/api/applications?pageSize=50', { token: sam.token });
  assert.ok(list.json.items.length > 0);
  assert.ok(list.json.items.every((i) => i.createdByName === 'Sam Sales'));
  const others = await api.call('GET', '/api/applications?pageSize=50', { token: sara.token });
  const foreign = others.json.items[0];
  const peek = await api.call('GET', `/api/applications/${foreign.id}`, { token: sam.token });
  assert.equal(peek.status, 404);
});

test('REVIEWER only sees applications assigned to them, never drafts', async (t) => {
  const api = await start(t);
  const riley = await api.login(emails.riley);
  const list = await api.call('GET', '/api/applications?pageSize=50', { token: riley.token });
  assert.ok(list.json.items.length > 0);
  assert.ok(list.json.items.every((i) => i.assignedReviewerName === 'Riley Reviewer' && i.status !== 'DRAFT'));
});

test('ADMIN sees all applications', async (t) => {
  const api = await start(t);
  const alex = await api.login(emails.alex);
  const list = await api.call('GET', '/api/applications?pageSize=50', { token: alex.token });
  assert.equal(list.json.total, api.store.apps.length);
});

test('only the assigned REVIEWER can decide: other roles/reviewers are blocked', async (t) => {
  const api = await start(t);
  const inReview = api.store.apps.find((a) => a.status === 'IN_REVIEW');
  const assigned = inReview.assignedReviewerId === 'u-rev-1' ? emails.riley : emails.robin;
  const other = assigned === emails.riley ? emails.robin : emails.riley;
  const decision = { decision: 'APPROVED', riskLevel: 'LOW', note: 'Looks fine to me, all documents match.' };

  const owner = await api.login(api.store.apps.find((a) => a.id === inReview.id).createdBy === 'u-sales-1' ? emails.sam : emails.sara);
  const asSales = await api.call('POST', `/api/applications/${inReview.id}/decision`, { token: owner.token, body: decision });
  assert.equal(asSales.status, 403);

  const otherReviewer = await api.login(other);
  const asOther = await api.call('POST', `/api/applications/${inReview.id}/decision`, { token: otherReviewer.token, body: decision });
  assert.equal(asOther.status, 404);

  const admin = await api.login(emails.alex);
  const asAdmin = await api.call('POST', `/api/applications/${inReview.id}/decision`, { token: admin.token, body: decision });
  assert.equal(asAdmin.status, 403);

  const reviewer = await api.login(assigned);
  const invalid = await api.call('POST', `/api/applications/${inReview.id}/decision`, { token: reviewer.token, body: { ...decision, note: 'short' } });
  assert.equal(invalid.status, 422);
  const ok = await api.call('POST', `/api/applications/${inReview.id}/decision`, { token: reviewer.token, body: decision });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'APPROVED');
  const again = await api.call('POST', `/api/applications/${inReview.id}/decision`, { token: reviewer.token, body: decision });
  assert.equal(again.status, 409);
});

test('only ADMIN can assign; SALES and REVIEWER get 403', async (t) => {
  const api = await start(t);
  const submitted = api.store.apps.find((a) => a.status === 'SUBMITTED');
  const ownerEmail = submitted.createdBy === 'u-sales-1' ? emails.sam : emails.sara;
  const owner = await api.login(ownerEmail);
  const riley = await api.login(emails.riley);
  const admin = await api.login(emails.alex);
  const body = { reviewerId: 'u-rev-1' };
  assert.equal((await api.call('PUT', `/api/applications/${submitted.id}/assignment`, { token: owner.token, body })).status, 403);
  assert.equal((await api.call('PUT', `/api/applications/${submitted.id}/assignment`, { token: riley.token, body })).status, 403);
  assert.equal((await api.call('GET', '/api/reviewers', { token: owner.token })).status, 403);
  const ok = await api.call('PUT', `/api/applications/${submitted.id}/assignment`, { token: admin.token, body });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'IN_REVIEW');
  const bad = await api.call('PUT', `/api/applications/${submitted.id}/assignment`, { token: admin.token, body: { reviewerId: 'u-sales-1' } });
  assert.equal(bad.status, 422);
});

test('sensitive fields are masked by default; reveal is role-restricted and audited', async (t) => {
  const api = await start(t);
  const target = api.store.apps.find((a) => a.status === 'IN_REVIEW');
  const rawTaxId = target.data.business.taxId;
  const admin = await api.login(emails.alex);
  const detail = await api.call('GET', `/api/applications/${target.id}`, { token: admin.token });
  assert.equal(detail.json.sensitiveMasked, true);
  assert.notEqual(detail.json.data.business.taxId, rawTaxId);
  assert.ok(detail.json.data.business.taxId.startsWith('••••'));
  assert.equal(JSON.stringify(detail.json).includes(rawTaxId), false);

  const ownerEmail = target.createdBy === 'u-sales-1' ? emails.sam : emails.sara;
  const owner = await api.login(ownerEmail);
  const asSales = await api.call('POST', `/api/applications/${target.id}/reveal`, { token: owner.token, body: { field: 'taxId' } });
  assert.equal(asSales.status, 403);

  const before = api.store.audit.length;
  const asAdmin = await api.call('POST', `/api/applications/${target.id}/reveal`, { token: admin.token, body: { field: 'taxId' } });
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.json.value, rawTaxId);
  assert.equal(api.store.audit.length, before + 1);
});

test('SALES draft lifecycle: create, mass-assignment ignored, submit validation, edit lock', async (t) => {
  const api = await start(t);
  const sam = await api.login(emails.sam);
  const created = await api.call('POST', '/api/applications', { token: sam.token, body: { business: { legalName: 'Draft Co' }, status: 'APPROVED', createdBy: 'u-admin-1' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.status, 'DRAFT');
  const id = created.json.id;
  assert.equal(api.store.apps.find((a) => a.id === id).createdBy, 'u-sales-1');

  const put = await api.call('PUT', `/api/applications/${id}/draft`, { token: sam.token, body: { business: { legalName: 'Draft Co 2' }, status: 'APPROVED', assignedReviewerId: 'u-rev-1' } });
  assert.equal(put.status, 200);
  const stored = api.store.apps.find((a) => a.id === id);
  assert.equal(stored.status, 'DRAFT');
  assert.equal(stored.assignedReviewerId, null);

  const incomplete = await api.call('POST', `/api/applications/${id}/submit`, { token: sam.token });
  assert.equal(incomplete.status, 422);
  assert.ok(incomplete.json.errors['business.taxId']);

  // Reviewers and admins cannot create applications.
  const riley = await api.login(emails.riley);
  assert.equal((await api.call('POST', '/api/applications', { token: riley.token, body: {} })).status, 403);

  // Another sales user cannot edit this draft.
  const sara = await api.login(emails.sara);
  assert.equal((await api.call('PUT', `/api/applications/${id}/draft`, { token: sara.token, body: {} })).status, 404);

  // A complete draft submits, and then is locked.
  const full = structuredClone(api.store.apps.find((a) => a.status === 'SUBMITTED' && a.createdBy === 'u-sales-1').data);
  await api.call('PUT', `/api/applications/${id}/draft`, { token: sam.token, body: full });
  const submitted = await api.call('POST', `/api/applications/${id}/submit`, { token: sam.token });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.json.status, 'SUBMITTED');
  assert.equal((await api.call('PUT', `/api/applications/${id}/draft`, { token: sam.token, body: full })).status, 409);
});

test('owner sees raw values in their own draft only', async (t) => {
  const api = await start(t);
  const draft = api.store.apps.find((a) => a.status === 'DRAFT');
  const ownerEmail = draft.createdBy === 'u-sales-1' ? emails.sam : emails.sara;
  const owner = await api.login(ownerEmail);
  const mine = await api.call('GET', `/api/applications/${draft.id}`, { token: owner.token });
  assert.equal(mine.json.data.business.taxId, draft.data.business.taxId);
  assert.equal(mine.json.permissions.canEdit, true);
  const admin = await api.login(emails.alex);
  const asAdmin = await api.call('GET', `/api/applications/${draft.id}`, { token: admin.token });
  assert.notEqual(asAdmin.json.data.business.taxId, draft.data.business.taxId);
  assert.equal(asAdmin.json.permissions.canEdit, false);
});

test('pagination and filtering are applied server-side', async (t) => {
  const api = await start(t);
  const admin = await api.login(emails.alex);
  const p1 = await api.call('GET', '/api/applications?page=1&pageSize=10', { token: admin.token });
  const p2 = await api.call('GET', '/api/applications?page=2&pageSize=10', { token: admin.token });
  assert.equal(p1.json.items.length, 10);
  assert.notDeepEqual(p1.json.items.map((i) => i.id), p2.json.items.map((i) => i.id));
  const approved = await api.call('GET', '/api/applications?status=APPROVED&pageSize=50', { token: admin.token });
  assert.ok(approved.json.items.every((i) => i.status === 'APPROVED'));
  const search = await api.call('GET', '/api/applications?q=bakery&pageSize=50', { token: admin.token });
  assert.ok(search.json.items.length > 0 && search.json.items.every((i) => i.legalName.toLowerCase().includes('bakery')));
  const clamped = await api.call('GET', '/api/applications?pageSize=9999', { token: admin.token });
  assert.equal(clamped.json.pageSize, 50);
});

test('refresh rotates the token; re-using the old one is rejected and revokes the family', async (t) => {
  const api = await start(t);
  const s = await api.login(emails.sam);
  const first = await api.call('POST', '/api/auth/refresh', { headers: { ...CSRF, cookie: s.cookie } });
  assert.equal(first.status, 200);
  assert.ok(first.json.accessToken);
  const newCookie = first.headers.get('set-cookie').split(';')[0];
  assert.notEqual(newCookie, s.cookie);

  const replay = await api.call('POST', '/api/auth/refresh', { headers: { ...CSRF, cookie: s.cookie } });
  assert.equal(replay.status, 401);
  const afterRevoke = await api.call('POST', '/api/auth/refresh', { headers: { ...CSRF, cookie: newCookie } });
  assert.equal(afterRevoke.status, 401);
});

test('refresh requires the CSRF header', async (t) => {
  const api = await start(t);
  const s = await api.login(emails.sam);
  const r = await api.call('POST', '/api/auth/refresh', { headers: { cookie: s.cookie } });
  assert.equal(r.status, 403);
});

test('expired access tokens are rejected with 401', async (t) => {
  const api = await start(t, { accessTtlMs: 30 });
  const s = await api.login(emails.sam);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal((await api.call('GET', '/api/me', { token: s.token })).status, 401);
});

test('logout revokes the refresh token', async (t) => {
  const api = await start(t);
  const s = await api.login(emails.sam);
  const out = await api.call('POST', '/api/auth/logout', { token: s.token, headers: { ...CSRF, cookie: s.cookie } });
  assert.equal(out.status, 204);
  const r = await api.call('POST', '/api/auth/refresh', { headers: { ...CSRF, cookie: s.cookie } });
  assert.equal(r.status, 401);
});

test('a JSON body that is not an object is a 400, not a server crash', async (t) => {
  const api = await start(t);
  const r = await api.call('POST', '/api/auth/login', { body: 'just a string' });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'JSON body must be an object');
});

'use strict';
/**
 * Deterministic, entirely synthetic seed data.
 *
 * - No real people, companies, or payment data. Names are generated from word lists,
 *   e-mail addresses use the reserved example.com domain.
 * - Routing numbers start with "0000", a prefix the US Federal Reserve never assigns, so they
 *   can pass the checksum used by the UI validator but can never match a real bank.
 * - There are NO passwords here. The mock server assigns one at startup (see server.js).
 */

// Small seeded PRNG (mulberry32) so the data is identical on every run.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = [
  { id: 'u-sales-1', name: 'Sam Sales', email: 'sam.sales@example.com', role: 'SALES' },
  { id: 'u-sales-2', name: 'Sara Seller', email: 'sara.seller@example.com', role: 'SALES' },
  { id: 'u-rev-1', name: 'Riley Reviewer', email: 'riley.reviewer@example.com', role: 'REVIEWER' },
  { id: 'u-rev-2', name: 'Robin Risk', email: 'robin.risk@example.com', role: 'REVIEWER' },
  { id: 'u-admin-1', name: 'Alex Admin', email: 'alex.admin@example.com', role: 'ADMIN' },
];

const NOUNS = ['Bakery', 'Garage', 'Studio', 'Market', 'Florist', 'Cafe', 'Hardware', 'Clinic', 'Books', 'Laundry'];
const FIRST = ['Avery', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Quinn', 'Drew', 'Jamie'];
const LAST = ['Stone', 'Rivers', 'Fields', 'Brooks', 'Woods', 'Hill', 'Lake', 'Dale'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

function digits(rand, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(rand() * 10);
  return s;
}

/** Builds "0000" + 4 digits + checksum digit so the ABA checksum (3-7-1 weights) validates. */
function syntheticRouting(rand) {
  const first8 = '0000' + digits(rand, 4);
  const d = first8.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
  const check = (10 - (sum % 10)) % 10;
  return first8 + check;
}

function buildSeed(count = 37) {
  const rand = prng(20261104);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const sales = USERS.filter((u) => u.role === 'SALES');
  const reviewers = USERS.filter((u) => u.role === 'REVIEWER');
  const day = 86_400_000;
  const base = Date.UTC(2026, 9, 1);
  const apps = [];

  for (let i = 1; i <= count; i++) {
    const status = STATUSES[i % STATUSES.length];
    const owner = pick(sales);
    const createdAt = new Date(base + i * day * 0.7).toISOString();
    const reviewer = status === 'DRAFT' || status === 'SUBMITTED' ? null : pick(reviewers);
    const noun = pick(NOUNS);
    const split = rand() < 0.5;
    const history = [];
    if (status !== 'DRAFT') {
      history.push({ id: `h-${i}-1`, at: createdAt, byName: owner.name, type: 'SUBMISSION', note: 'Application submitted' });
    }
    if (reviewer) {
      history.push({ id: `h-${i}-2`, at: createdAt, byName: 'Alex Admin', type: 'ASSIGNMENT', note: `Assigned to ${reviewer.name}` });
    }
    if (status === 'APPROVED' || status === 'REJECTED') {
      history.push({
        id: `h-${i}-3`,
        at: createdAt,
        byName: reviewer.name,
        type: 'DECISION',
        riskLevel: status === 'APPROVED' ? 'LOW' : 'HIGH',
        note: status === 'APPROVED' ? 'Documents consistent, low risk profile.' : 'Unable to verify ownership structure.',
      });
    }
    apps.push({
      id: `app-${String(i).padStart(4, '0')}`,
      status,
      createdBy: owner.id,
      assignedReviewerId: reviewer ? reviewer.id : null,
      createdAt,
      updatedAt: createdAt,
      data: {
        business: {
          legalName: `Sample ${noun} ${String(i).padStart(2, '0')} LLC`,
          dba: `${noun} ${i}`,
          taxId: `00-${digits(rand, 7)}`,
          industry: pick(['Retail', 'Food & Beverage', 'Services', 'Healthcare']),
          website: '',
          phone: `+1 555 01${digits(rand, 2)}`,
          email: `contact${i}@example.com`,
          line1: `${100 + i} Sample Street`,
          city: 'Exampleville',
          postalCode: digits(rand, 5),
        },
        owners: split
          ? [
              { fullName: `${pick(FIRST)} ${pick(LAST)}`, title: 'Co-founder', ownershipPercent: 60, nationalId: `000-00-${digits(rand, 4)}`, email: `owner${i}a@example.com` },
              { fullName: `${pick(FIRST)} ${pick(LAST)}`, title: 'Co-founder', ownershipPercent: 40, nationalId: `000-00-${digits(rand, 4)}`, email: `owner${i}b@example.com` },
            ]
          : [{ fullName: `${pick(FIRST)} ${pick(LAST)}`, title: 'Owner', ownershipPercent: 100, nationalId: `000-00-${digits(rand, 4)}`, email: `owner${i}@example.com` }],
        banking: {
          bankName: 'Sample Test Bank',
          routingNumber: syntheticRouting(rand),
          accountNumber: `0000${digits(rand, 8)}`,
        },
      },
      riskHistory: history,
    });
  }
  return apps;
}

module.exports = { USERS, buildSeed };

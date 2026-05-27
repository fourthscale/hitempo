import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openRlsClient, openServiceClient } from "../helpers/rls-client";

/**
 * RLS guarantees on the sprint-04 business tables (companies, sites, contacts).
 * Replicates the same shape as tests/rls/multi-tenant.test.ts but for the new tables.
 *
 * Each test exercises one of the canonical guarantees from docs/conventions/rls.md.
 */
describe("multi-tenant RLS on business tables", () => {
  const userA = randomUUID();
  const userB = randomUUID();

  let orgA: string;
  let orgB: string;
  let companyA: string;
  let companyB: string;
  let siteA: string;
  let contactA: string;

  const admin = openServiceClient();

  beforeAll(async () => {
    // Fake auth users
    await admin.sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
      VALUES
        (${userA}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`biz-a-${userA}@test.local`}, '{}', '{}', now(), now(), now()),
        (${userB}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`biz-b-${userB}@test.local`}, '{}', '{}', now(), now(), now())
    `;

    const [a] = await admin.sql<{ id: string }[]>`
      INSERT INTO organizations (slug, name, plan, default_locale)
      VALUES (${`biz-test-a-${userA.slice(0, 8)}`}, 'Biz A', 'trial', 'fr') RETURNING id
    `;
    const [b] = await admin.sql<{ id: string }[]>`
      INSERT INTO organizations (slug, name, plan, default_locale)
      VALUES (${`biz-test-b-${userB.slice(0, 8)}`}, 'Biz B', 'trial', 'fr') RETURNING id
    `;
    if (!a || !b) throw new Error("Failed to create test orgs");
    orgA = a.id;
    orgB = b.id;

    await admin.sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${orgA}, ${userA}, 'owner'), (${orgB}, ${userB}, 'owner')
    `;

    const [ca] = await admin.sql<{ id: string }[]>`
      INSERT INTO companies (organization_id, name) VALUES (${orgA}, 'A Co') RETURNING id
    `;
    const [cb] = await admin.sql<{ id: string }[]>`
      INSERT INTO companies (organization_id, name) VALUES (${orgB}, 'B Co') RETURNING id
    `;
    if (!ca || !cb) throw new Error("Failed to create test companies");
    companyA = ca.id;
    companyB = cb.id;

    const [sa] = await admin.sql<{ id: string }[]>`
      INSERT INTO sites (organization_id, company_id, name) VALUES (${orgA}, ${companyA}, 'A Site') RETURNING id
    `;
    if (!sa) throw new Error("Failed to create test site");
    siteA = sa.id;

    const [conA] = await admin.sql<{ id: string }[]>`
      INSERT INTO contacts (organization_id, company_id, first_name, last_name)
      VALUES (${orgA}, ${companyA}, 'A', 'Contact') RETURNING id
    `;
    if (!conA) throw new Error("Failed to create test contact");
    contactA = conA.id;
  });

  afterAll(async () => {
    await admin.sql`DELETE FROM contacts WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM sites WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM companies WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM organization_members WHERE user_id IN (${userA}, ${userB})`;
    if (orgA) await admin.sql`DELETE FROM organizations WHERE id = ${orgA}`;
    if (orgB) await admin.sql`DELETE FROM organizations WHERE id = ${orgB}`;
    await admin.sql`DELETE FROM auth.users WHERE id IN (${userA}, ${userB})`;
    await admin.end();
  });

  it("user A sees only their own companies", async () => {
    const a = openRlsClient(userA);
    try {
      const rows = await a.query<{ id: string }>(
        `SELECT id FROM companies WHERE id IN ($1, $2)`,
        [companyA, companyB],
      );
      expect(rows.map((r) => r.id)).toEqual([companyA]);
    } finally {
      await a.end();
    }
  });

  it("user A sees only their own sites", async () => {
    const a = openRlsClient(userA);
    try {
      const rows = await a.query<{ id: string }>(`SELECT id FROM sites`);
      expect(rows.every((r) => r.id === siteA)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await a.end();
    }
  });

  it("user A sees only their own contacts", async () => {
    const a = openRlsClient(userA);
    try {
      const rows = await a.query<{ id: string }>(`SELECT id FROM contacts`);
      expect(rows.every((r) => r.id === contactA)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await a.end();
    }
  });

  it("user B cannot UPDATE company A", async () => {
    const b = openRlsClient(userB);
    try {
      const rows = await b.query<{ id: string }>(
        `UPDATE companies SET name = 'pwned' WHERE id = $1 RETURNING id`,
        [companyA],
      );
      expect(rows).toHaveLength(0);
      const [check] = await admin.sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${companyA}`;
      expect(check?.name).toBe("A Co");
    } finally {
      await b.end();
    }
  });

  it("user B cannot INSERT into org A's contacts", async () => {
    const b = openRlsClient(userB);
    try {
      const rows = await b.query<{ id: string }>(
        `INSERT INTO contacts (organization_id, company_id, first_name, last_name)
         VALUES ($1, $2, 'X', 'Y') RETURNING id`,
        [orgA, companyA],
      );
      expect(rows).toHaveLength(0);
    } catch (e) {
      // RLS rejection raises an error in Postgres; either zero rows or error is acceptable
      expect(String(e)).toMatch(/row-level security|policy/i);
    } finally {
      await b.end();
    }
  });

  it("contacts.full_name is computed as first_name || ' ' || last_name", async () => {
    const [row] = await admin.sql<{ full_name: string }[]>`
      SELECT full_name FROM contacts WHERE id = ${contactA}
    `;
    expect(row?.full_name).toBe("A Contact");
  });
});

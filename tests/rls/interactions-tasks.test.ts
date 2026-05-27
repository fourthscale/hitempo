import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openRlsClient, openServiceClient } from "../helpers/rls-client";

describe("multi-tenant RLS on interactions and tasks tables", () => {
  const userA = randomUUID();
  const userB = randomUUID();

  let orgA: string;
  let orgB: string;
  let companyA: string;
  let companyB: string;
  let contactA: string;
  let interactionA: string;
  let taskA: string;

  const admin = openServiceClient();

  beforeAll(async () => {
    await admin.sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
      VALUES
        (${userA}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`ia-a-${userA}@test.local`}, '{}', '{}', now(), now(), now()),
        (${userB}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`ia-b-${userB}@test.local`}, '{}', '{}', now(), now(), now())
    `;

    const [a] = await admin.sql<{ id: string }[]>`
      INSERT INTO organizations (slug, name, plan, default_locale)
      VALUES (${`ia-test-a-${userA.slice(0, 8)}`}, 'IA Org A', 'trial', 'fr') RETURNING id
    `;
    const [b] = await admin.sql<{ id: string }[]>`
      INSERT INTO organizations (slug, name, plan, default_locale)
      VALUES (${`ia-test-b-${userB.slice(0, 8)}`}, 'IA Org B', 'trial', 'fr') RETURNING id
    `;
    if (!a || !b) throw new Error("Failed to create test orgs");
    orgA = a.id;
    orgB = b.id;

    await admin.sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${orgA}, ${userA}, 'owner'), (${orgB}, ${userB}, 'owner')
    `;

    const [ca] = await admin.sql<{ id: string }[]>`
      INSERT INTO companies (organization_id, name) VALUES (${orgA}, 'IA A Co') RETURNING id
    `;
    const [cb] = await admin.sql<{ id: string }[]>`
      INSERT INTO companies (organization_id, name) VALUES (${orgB}, 'IA B Co') RETURNING id
    `;
    if (!ca || !cb) throw new Error("Failed to create test companies");
    companyA = ca.id;
    companyB = cb.id;

    const [conA] = await admin.sql<{ id: string }[]>`
      INSERT INTO contacts (organization_id, company_id, first_name, last_name)
      VALUES (${orgA}, ${companyA}, 'IA', 'Contact A') RETURNING id
    `;
    if (!conA) throw new Error("Failed to create test contact");
    contactA = conA.id;

    const [intA] = await admin.sql<{ id: string }[]>`
      INSERT INTO interactions (organization_id, company_id, contact_id, type, channel, occurred_at)
      VALUES (${orgA}, ${companyA}, ${contactA}, 'first_contact', 'email', now()) RETURNING id
    `;
    const [intB] = await admin.sql<{ id: string }[]>`
      INSERT INTO interactions (organization_id, company_id, type, channel, occurred_at)
      VALUES (${orgB}, ${companyB}, 'first_contact', 'email', now()) RETURNING id
    `;
    if (!intA || !intB) throw new Error("Failed to create test interactions");
    interactionA = intA.id;

    const [taskARow] = await admin.sql<{ id: string }[]>`
      INSERT INTO tasks (organization_id, company_id, type, title, status, priority)
      VALUES (${orgA}, ${companyA}, 'email', 'IA Task A', 'pending', 'medium') RETURNING id
    `;
    const [taskBRow] = await admin.sql<{ id: string }[]>`
      INSERT INTO tasks (organization_id, company_id, type, title, status, priority)
      VALUES (${orgB}, ${companyB}, 'email', 'IA Task B', 'pending', 'medium') RETURNING id
    `;
    if (!taskARow || !taskBRow) throw new Error("Failed to create test tasks");
    taskA = taskARow.id;
  });

  afterAll(async () => {
    await admin.sql`DELETE FROM tasks WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM interactions WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM contacts WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM companies WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.sql`DELETE FROM organization_members WHERE user_id IN (${userA}, ${userB})`;
    if (orgA) await admin.sql`DELETE FROM organizations WHERE id = ${orgA}`;
    if (orgB) await admin.sql`DELETE FROM organizations WHERE id = ${orgB}`;
    await admin.sql`DELETE FROM auth.users WHERE id IN (${userA}, ${userB})`;
    await admin.end();
  });

  it("user A sees only their own interactions", async () => {
    const a = openRlsClient(userA);
    try {
      const rows = await a.query<{ id: string }>(
        `SELECT id FROM interactions WHERE organization_id IN ($1, $2)`,
        [orgA, orgB],
      );
      expect(rows.every((r) => r.id === interactionA)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await a.end();
    }
  });

  it("user B cannot read org A interactions", async () => {
    const b = openRlsClient(userB);
    try {
      const rows = await b.query<{ id: string }>(
        `SELECT id FROM interactions WHERE id = $1`,
        [interactionA],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await b.end();
    }
  });

  it("user A sees only their own tasks", async () => {
    const a = openRlsClient(userA);
    try {
      const rows = await a.query<{ id: string }>(
        `SELECT id FROM tasks WHERE organization_id IN ($1, $2)`,
        [orgA, orgB],
      );
      expect(rows.every((r) => r.id === taskA)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await a.end();
    }
  });

  it("user B cannot read org A tasks", async () => {
    const b = openRlsClient(userB);
    try {
      const rows = await b.query<{ id: string }>(
        `SELECT id FROM tasks WHERE id = $1`,
        [taskA],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await b.end();
    }
  });

  it("user B cannot INSERT a task into org A", async () => {
    const b = openRlsClient(userB);
    try {
      const rows = await b.query<{ id: string }>(
        `INSERT INTO tasks (organization_id, company_id, type, title, status, priority)
         VALUES ($1, $2, 'email', 'pwned task', 'pending', 'low') RETURNING id`,
        [orgA, companyA],
      );
      expect(rows).toHaveLength(0);
    } catch (e) {
      expect(String(e)).toMatch(/row-level security|policy/i);
    } finally {
      await b.end();
    }
  });

  it("user B cannot INSERT an interaction into org A", async () => {
    const b = openRlsClient(userB);
    try {
      const rows = await b.query<{ id: string }>(
        `INSERT INTO interactions (organization_id, company_id, type, channel, occurred_at)
         VALUES ($1, $2, 'note', 'email', now()) RETURNING id`,
        [orgA, companyA],
      );
      expect(rows).toHaveLength(0);
    } catch (e) {
      expect(String(e)).toMatch(/row-level security|policy/i);
    } finally {
      await b.end();
    }
  });
});

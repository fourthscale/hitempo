import "server-only";
import { sql } from "drizzle-orm";
import { getAdminDb } from "@/db/client";

export type OrgMember = {
  userId: string;
  role: string;
  email: string;
  displayName: string;
};

export async function getOrgMembersWithNames(orgId: string): Promise<OrgMember[]> {
  const rows = await getAdminDb().execute(sql`
    SELECT
      om.user_id   AS "userId",
      om.role,
      u.email,
      COALESCE(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name',
        split_part(u.email, '@', 1)
      ) AS "displayName"
    FROM organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.organization_id = ${orgId}
    ORDER BY "displayName"
  `);
  return rows as unknown as OrgMember[];
}

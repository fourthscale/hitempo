import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/auth/context";
import { getContactsForTaskForm } from "@/db/queries/tasks";

export async function GET(req: NextRequest) {
  const { activeOrganization } = await getActiveOrg();
  const companyId = req.nextUrl.searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json([]);
  }

  const contacts = await getContactsForTaskForm(activeOrganization.id, companyId);
  return NextResponse.json(contacts);
}

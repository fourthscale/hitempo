ALTER TABLE "companies" ADD COLUMN "organisation_ref" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "organisation_ref" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "organisation_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_companies_org_ref" ON "companies" USING btree ("organization_id","organisation_ref") WHERE organisation_ref IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_contacts_org_ref" ON "contacts" USING btree ("organization_id","organisation_ref") WHERE organisation_ref IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sites_org_ref" ON "sites" USING btree ("organization_id","organisation_ref") WHERE organisation_ref IS NOT NULL;
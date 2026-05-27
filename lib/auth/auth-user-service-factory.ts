import "server-only";

import { AuthUserService } from "./auth-user-service";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Lazy singleton factory for `AuthUserService`.
 *
 * Server actions and pages call `AuthUserServiceFactory.getInstance()` to
 * get the configured service. `setInstance()` + `reset()` let tests inject
 * a stub backed by a fake Supabase client.
 */
export class AuthUserServiceFactory {
  private static cached: AuthUserService | null = null;

  public static getInstance(): AuthUserService {
    if (this.cached) return this.cached;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    this.cached = new AuthUserService(getSupabaseAdmin(), siteUrl);
    return this.cached;
  }

  public static setInstance(service: AuthUserService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}

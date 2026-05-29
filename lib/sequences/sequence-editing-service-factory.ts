import "server-only";
import { getDb } from "@/db/client";
import { SequenceEditingService } from "./sequence-editing-service";

/**
 * Builds a `SequenceEditingService` bound to the request-scoped RLS pool.
 *
 * Not a cached singleton : `getDb()` is request-scoped, and the editing flow
 * always runs as the authenticated user (RLS on). `getInstance()` is the
 * canonical entry point.
 */
export class SequenceEditingServiceFactory {
  static getInstance(): SequenceEditingService {
    return new SequenceEditingService({ db: getDb() });
  }
}

import "server-only";
import { getAdminDb } from "@/db/client";
import { SequenceEngine } from "./sequence-engine";
import { EngineExecutorServices } from "./engine-executor-services";

/**
 * Builds a `SequenceEngine` bound to the admin pool (the engine runs in Inngest
 * crons / handlers, outside an RLS user session). `getInstance()` is the
 * canonical entry point.
 */
export class SequenceEngineFactory {
  static getInstance(): SequenceEngine {
    const db = getAdminDb();
    return new SequenceEngine({
      db,
      services: new EngineExecutorServices({ db }),
    });
  }
}

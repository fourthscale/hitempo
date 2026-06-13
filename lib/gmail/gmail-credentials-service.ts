/**
 * Sprint 16 — `GmailCredentialsService` was unified under
 * `MailCredentialsService` (single table, provider column). This file
 * re-exports the new types under the legacy names so existing call
 * sites compile without immediate refactor. New code should import
 * from `@/lib/mail/mail-credentials-service` directly.
 */
export {
  MailCredentialsService as GmailCredentialsService,
  type DecryptedMailCredentials as DecryptedGmailCredentials,
  type MailCredentialsUpsertInput as GmailCredentialsUpsertInput,
} from "@/lib/mail/mail-credentials-service";

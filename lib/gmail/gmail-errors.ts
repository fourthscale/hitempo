/**
 * Sprint 16 — the Gmail error hierarchy was unified under provider-
 * agnostic `Mail*` names. This file stays as a back-compat re-export so
 * existing call sites that import from `@/lib/gmail/gmail-errors`
 * compile without immediate refactor. New code should import from
 * `@/lib/mail/mail-errors` directly.
 *
 * The names below are TypeScript-level aliases — same runtime classes,
 * `instanceof` checks work transparently.
 */
export {
  MailError as GmailError,
  MailCredentialsNotFoundError as GmailCredentialsNotFoundError,
  MailOAuthError as GmailOAuthError,
  MissingMailEnvError as MissingGmailEnvError,
  MailApiError as GmailApiError,
  MailCredentialRevokedError as GmailCredentialRevokedError,
} from "@/lib/mail/mail-errors";

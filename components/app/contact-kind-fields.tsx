"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ContactKind = "person" | "generic";

/**
 * Client sub-form for the contact kind toggle (sprint 10.8).
 *
 * Renders the Personne / Générique segmented control + every field that is
 * a *person attribute* : first/last name, job title, role, LinkedIn. When
 * "Générique" is selected (an info@ / switchboard channel), those fields
 * are hidden — a generic address has no name, no job title, no personal
 * LinkedIn, and the person-centric role enum doesn't apply. A hint reminds
 * the user that an email or phone is required instead.
 *
 * The channel fields (email / phone / preferred language / status / …) stay
 * in the parent server form because they're meaningful for both kinds.
 *
 * Server-side Zod (contactBodySchema) is the authoritative validator ; the
 * `required` attributes here just follow the toggle for UX.
 */
export function ContactKindFields({
  initialKind = "person",
  initialFirstName,
  initialLastName,
  initialJobTitle,
  initialRole,
  initialLinkedinUrl,
  roleOptions,
  labels,
}: {
  initialKind?: ContactKind;
  initialFirstName?: string | null;
  initialLastName?: string | null;
  initialJobTitle?: string | null;
  initialRole?: string | null;
  initialLinkedinUrl?: string | null;
  roleOptions: { value: string; label: string }[];
  labels: {
    kindLabel: string;
    kindPerson: string;
    kindGeneric: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    role: string;
    linkedin: string;
    genericHint: string;
  };
}) {
  const [kind, setKind] = useState<ContactKind>(initialKind);
  const isPerson = kind === "person";

  return (
    <>
      {/* Kind toggle — spans both columns. */}
      <div className="md:col-span-2 flex flex-col gap-1">
        <Label>{labels.kindLabel}</Label>
        <input type="hidden" name="kind" value={kind} />
        <div className="inline-flex rounded-md border border-border bg-background p-0.5 w-fit">
          {(["person", "generic"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-[5px] transition-colors",
                kind === k
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "person" ? labels.kindPerson : labels.kindGeneric}
            </button>
          ))}
        </div>
      </div>

      {isPerson ? (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="firstName">{labels.firstName} *</Label>
            <Input
              id="firstName"
              name="firstName"
              required
              defaultValue={initialFirstName ?? ""}
              maxLength={100}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lastName">{labels.lastName} *</Label>
            <Input
              id="lastName"
              name="lastName"
              required
              defaultValue={initialLastName ?? ""}
              maxLength={100}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="jobTitle">{labels.jobTitle}</Label>
            <Input id="jobTitle" name="jobTitle" defaultValue={initialJobTitle ?? ""} maxLength={150} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="role">{labels.role}</Label>
            <select
              id="role"
              name="role"
              defaultValue={initialRole ?? ""}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="linkedinUrl">{labels.linkedin}</Label>
            <Input
              id="linkedinUrl"
              name="linkedinUrl"
              type="url"
              defaultValue={initialLinkedinUrl ?? ""}
              placeholder="https://linkedin.com/in/..."
            />
          </div>
        </>
      ) : (
        <div className="md:col-span-2 text-xs text-muted-foreground rounded-md bg-secondary/40 px-3 py-2">
          {labels.genericHint}
        </div>
      )}
    </>
  );
}

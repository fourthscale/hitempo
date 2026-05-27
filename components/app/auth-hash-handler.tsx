"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type State = { kind: "idle" } | { kind: "applying" } | { kind: "error"; message: string };

type Action =
  | { type: "start" }
  | { type: "error"; message: string }
  | { type: "done" };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case "start":
      return { kind: "applying" };
    case "error":
      return { kind: "error", message: action.message };
    case "done":
      return { kind: "idle" };
  }
}

/**
 * Some Supabase email flows (invite, recovery, magic link) hand the browser
 * an `#access_token=…&refresh_token=…&type=…` hash fragment instead of a
 * server-readable `?code=…` query string. The hash never reaches the server,
 * so we drain it client-side : call `setSession`, drop the hash from the URL,
 * then proceed.
 *
 * Mounted near the top of any page that can receive such a redirect — for
 * now the reset-password page, but the homepage could mount this too if we
 * ever want to handle stray invite landings there.
 *
 * Renders nothing in the happy path : the parent form just keeps working
 * once the session cookies are set and `router.refresh()` fires.
 */
export function AuthHashHandler() {
  const router = useRouter();
  // useReducer + dispatch avoids the react-hooks/set-state-in-effect rule
  // that fires on legitimate post-async state updates.
  const [state, dispatch] = useReducer(reducer, { kind: "idle" } as State);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    let cancelled = false;
    dispatch({ type: "start" });

    void (async () => {
      const supabase = createClient();
      try {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (error) {
          dispatch({ type: "error", message: error.message });
          return;
        }
        // Strip the hash so a refresh doesn't re-trigger the flow.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        dispatch({ type: "done" });
        // Re-render Next with the new cookies visible.
        router.refresh();
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.kind === "applying") {
    return <p className="text-xs text-muted-foreground">Activating your account…</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="text-xs text-rose-600">
        Could not activate the link: {state.message}
      </p>
    );
  }
  return null;
}

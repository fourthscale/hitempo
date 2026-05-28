/**
 * Official Gmail envelope mark (4-color). Used as the leading icon for
 * the Gmail OAuth connect button (settings/profile) and the "Envoyer via
 * Gmail" CTA in the generate-message dialog. The SVG is inlined to avoid
 * a network round-trip and keep the brand colors consistent.
 */
export function GmailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 193" className={className} aria-hidden="true">
      <path
        fill="#4285f4"
        d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455h40.727z"
      />
      <path
        fill="#34a853"
        d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.026 25.798v98.91z"
      />
      <path
        fill="#ea4335"
        d="M58.182 93.14l-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 33.95-4.669 41.685L128 145.504z"
      />
      <path
        fill="#fbbc04"
        d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945l-16.292 12.218z"
      />
      <path
        fill="#c5221f"
        d="M0 49.504L26.759 69.577 58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.231v23.273z"
      />
    </svg>
  );
}

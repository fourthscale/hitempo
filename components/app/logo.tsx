import { cn } from "@/lib/utils";

type LogoVariant = "white" | "blue";

/**
 * hitempo logo — SVG inline.
 * - 3 teal dots + 1 amber dash in the top row.
 * - "hitempo" wordmark below in Playfair Display (var(--font-serif)).
 *
 * `variant` controls only the wordmark color (white for dark backgrounds,
 * deep navy for light backgrounds). Dots & dash always use brand colors.
 *
 * Sizing: the SVG scales to its container. Use `className` for height/width.
 * Aspect ratio is locked at ~22:8 (viewBox).
 */
export function Logo({
  variant = "white",
  className,
}: {
  variant?: LogoVariant;
  className?: string;
}) {
  const wordmarkColor = variant === "white" ? "#ffffff" : "#0f172a";

  return (
    <svg
      viewBox="0 0 220 88"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="hitempo"
      className={cn("block h-8 w-auto", className)}
    >
      {/* Top row: 3 teal dots + 1 amber dash.
          First dot's left edge sits at x=0 so it aligns with the `h` of the wordmark. */}
      <circle cx="6" cy="14" r="6" fill="var(--color-brand-teal)" />
      <circle cx="24" cy="14" r="6" fill="var(--color-brand-teal)" />
      <circle cx="42" cy="14" r="6" fill="var(--color-brand-teal)" />
      <rect
        x="58"
        y="9"
        width="36"
        height="10"
        rx="5"
        ry="5"
        fill="var(--color-brand-amber)"
      />

      {/* Wordmark — sits ~10 units below the dots row for breathing room */}
      <text
        x="0"
        y="82"
        fontFamily="var(--font-serif), Georgia, serif"
        fontSize="56"
        fontWeight={700}
        fill={wordmarkColor}
        letterSpacing="-1"
      >
        hitempo
      </text>
    </svg>
  );
}

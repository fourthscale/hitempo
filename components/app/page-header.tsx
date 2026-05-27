import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-6 mb-8", className)}>
      <div className="min-w-0">
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground tracking-tight">
          {title}
        </h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 text-sm text-right">{right}</div>}
    </div>
  );
}

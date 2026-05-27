"use client";

import { useRouter } from "next/navigation";

export function FilterSelect({
  name,
  value,
  options,
  params,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  params: Record<string, string>;
}) {
  const router = useRouter();

  function handleChange(newValue: string) {
    const p = new URLSearchParams(params);
    if (newValue === options[0]?.value) {
      p.delete(name);
    } else {
      p.set(name, newValue);
    }
    const qs = p.toString();
    router.push(qs ? `/tasks?${qs}` : "/tasks");
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className="h-8 px-2 rounded-md border border-border bg-background text-xs text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

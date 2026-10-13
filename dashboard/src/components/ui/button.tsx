import * as React from "react";
import { cn } from "../../lib/utils";

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card/70 px-3 text-sm font-semibold text-foreground transition hover:border-sky-300/60 hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

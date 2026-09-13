import type { HTMLAttributes, ReactNode } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "purple";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, { badge: string; dot: string }> = {
  default: {
    badge: "bg-slate-800 text-slate-300 border-slate-700",
    dot: "bg-slate-400",
  },
  success: {
    badge: "bg-emerald-950/60 text-emerald-300 border-emerald-800/40",
    dot: "bg-emerald-400",
  },
  warning: {
    badge: "bg-amber-950/60 text-amber-300 border-amber-800/40",
    dot: "bg-amber-400",
  },
  danger: {
    badge: "bg-rose-950/60 text-rose-300 border-rose-800/40",
    dot: "bg-rose-400",
  },
  info: {
    badge: "bg-sky-950/60 text-sky-300 border-sky-800/40",
    dot: "bg-sky-400",
  },
  purple: {
    badge: "bg-purple-950/60 text-purple-300 border-purple-800/40",
    dot: "bg-purple-400",
  },
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "text-[11px] px-2 py-0.5 gap-1.5",
  md: "text-xs px-2.5 py-1 gap-1.5",
};

export function Badge({
  variant = "default",
  size = "md",
  dot = false,
  className = "",
  children,
  ...props
}: BadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={`inline-flex items-center font-medium border rounded-full select-none ${styles.badge} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot}`} />}
      <span>{children}</span>
    </span>
  );
}

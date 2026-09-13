import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  children: ReactNode;
}

export function Card({ hover = false, className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`bg-elevated border border-strong rounded-xl overflow-hidden transition-all ${
        hover ? "hover:border-blue-500/50 hover:shadow-lg hover:shadow-black/30 cursor-pointer" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className = "",
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={`p-4 border-b border-default bg-base/40 flex items-center justify-between gap-3 ${className}`}
      {...props}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-primary truncate">{title}</div>
          {subtitle && <div className="text-xs text-secondary truncate">{subtitle}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardBody({ className = "", children, ...props }: CardBodyProps) {
  return <div className={`p-4 ${className}`} {...props}>{children}</div>;
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardFooter({ className = "", children, ...props }: CardFooterProps) {
  return (
    <div className={`p-3 border-t border-default bg-base/20 flex items-center justify-between text-xs text-secondary ${className}`} {...props}>
      {children}
    </div>
  );
}

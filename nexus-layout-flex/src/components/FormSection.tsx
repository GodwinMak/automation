import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormSectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}

export const FormSection = ({ title, icon, children, className }: FormSectionProps) => {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-6 card-hover animate-fade-in", className)}>
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
};

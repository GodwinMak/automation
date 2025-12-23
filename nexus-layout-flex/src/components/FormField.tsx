import { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  className?: string;
}

export const FormField = ({ label, htmlFor, children, required, hint, className }: FormFieldProps) => {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground flex items-center gap-1">
        {label}
        {required && <span className="text-primary">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

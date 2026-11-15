"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- Button */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[linear-gradient(135deg,#FFF3C4_0%,#FF9E1B_100%)] font-semibold text-[#050406] hover:shadow-[0_0_28px_rgba(255,158,27,0.5),0_0_10px_rgba(255,243,196,0.35)]",
        secondary: "border border-primary/30 bg-secondary text-secondary-foreground hover:border-primary/60 hover:shadow-[0_0_20px_rgba(217,56,30,0.25)]",
        outline: "border border-primary/30 bg-[#110C0E] text-foreground hover:border-primary/60 hover:bg-primary/10 hover:shadow-[0_0_20px_rgba(217,56,30,0.22)]",
        ghost: "hover:bg-primary/10 hover:text-primary",
        danger: "border border-danger/60 bg-transparent text-danger hover:bg-danger hover:text-background",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", lg: "h-11 px-6", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

/* ---------------------------------------------------------------- Card */
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("glass litho relative text-card-foreground", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-[15px] font-semibold leading-snug", className)} {...p} />;
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn("text-sm text-muted-foreground", className)} {...p} />;
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pt-2", className)} {...p} />;

/* ---------------------------------------------------------------- Badge */
const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase leading-4 tracking-[0.1em]", {
  variants: {
    tone: {
      neutral: "border-primary/20 bg-transparent text-muted-foreground",
      primary: "border-primary/45 bg-transparent text-primary",
      success: "border-success/45 bg-transparent text-success",
      warning: "border-warning/45 bg-transparent text-warning",
      danger: "border-danger/45 bg-transparent text-danger",
      violet: "border-primary/30 border-dashed bg-transparent text-primary/85",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...p} />
);

/* ---------------------------------------------------------------- Form controls */
const field = "w-full rounded-md border border-input bg-background/60 px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-9", className)} {...p} />
));
Input.displayName = "Input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-[96px] py-2 leading-relaxed", className)} {...p} />
));
Textarea.displayName = "Textarea";
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(field, "h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%238b98ad' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>
    {children}
  </select>
));
Select.displayName = "Select";
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn("mb-1.5 block text-xs font-medium text-muted-foreground", className)} {...p} />;

export const Skeleton = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("animate-pulse rounded-md bg-secondary/70", className)} {...p} />;

/* ---------------------------------------------------------------- Tabs */
export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn("flex w-full gap-1 overflow-x-auto border-b", className)} {...p} />
);
export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger className={cn("-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...p} />
);
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn("pt-5 focus-visible:outline-none", className)} {...p} />
);

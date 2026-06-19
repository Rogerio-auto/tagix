import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  // Base: fonte Manrope, peso 700, uppercase (DS v2 spec)
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-bold font-body uppercase tracking-wider transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        // CTA principal: gradiente verde + glow (≤1 por tela — regra DS v2)
        default: [
          "[background:linear-gradient(180deg,var(--brand),var(--brand-strong))]",
          "text-[var(--text-on-brand)]",
          "shadow-glow-md",
          "hover:shadow-glow-lg hover:-translate-y-0.5 hover:brightness-105",
          "active:translate-y-0 active:shadow-glow-sm",
        ].join(" "),
        // Destrutivo
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Borda sutil, vira verde no hover
        outline:
          "border border-border bg-transparent text-foreground hover:border-primary hover:text-primary hover:bg-primary/5",
        // Superfície neutra
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // Ghost: borda verde com glow interno (hero secundário)
        ghost: [
          "border border-primary bg-transparent text-primary",
          "shadow-[inset_0_0_12px_rgba(31,255,19,0.12)]",
          "hover:bg-primary/8 hover:shadow-glow-sm",
        ].join(" "),
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm:      "h-9 px-3 text-xs",
        lg:      "h-12 px-8 text-base",
        icon:    "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size:    "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }

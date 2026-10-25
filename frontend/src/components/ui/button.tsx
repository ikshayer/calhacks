// Adapted from shadcn/ui's new-york-v4 Button registry, using this app's theme.
// https://ui.shadcn.com/r/styles/new-york-v4/button.json
import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-ui-accent text-ui-on-accent hover:brightness-105',
        outline: 'border border-ui-border bg-ui-well text-ui-muted hover:border-ui-edge hover:text-ui-text',
        ghost: 'text-ui-muted hover:bg-ui-raised hover:text-ui-text',
      },
      size: { default: 'h-9 px-3.5 py-2', sm: 'h-8 px-3 py-1.5' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({ className, variant = 'default', size = 'default', ...props }:
  ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" data-variant={variant} data-size={size}
    className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

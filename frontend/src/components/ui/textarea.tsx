// Adapted from shadcn/ui's new-york-v4 Textarea registry, using this app's theme.
// https://ui.shadcn.com/r/styles/new-york-v4/textarea.json
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(
    'flex min-h-16 w-full resize-none rounded-md border border-ui-border bg-ui-surface px-3 py-2 text-base leading-relaxed text-ui-text shadow-xs transition-colors outline-none placeholder:text-ui-faint focus-visible:border-ui-accent focus-visible:ring-2 focus-visible:ring-ui-accent/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]',
    className,
  )} {...props} />
}

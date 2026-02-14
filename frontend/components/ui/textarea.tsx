import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('min-h-[96px] w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100', className)} {...props} />
));
Textarea.displayName = 'Textarea';

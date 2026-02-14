import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', {
  variants: {
    variant: {
      default: 'bg-brand-600 text-white',
      secondary: 'bg-slate-700 text-slate-100',
      success: 'bg-emerald-700 text-white',
      warning: 'bg-amber-700 text-white',
      danger: 'bg-rose-700 text-white',
      outline: 'border border-slate-700 text-slate-100',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

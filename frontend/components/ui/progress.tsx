import { cn } from '@/lib/utils';

export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-800', className)}>
      <div className="h-full bg-brand-500 transition-all" style={{ width: `${safe}%` }} />
    </div>
  );
}

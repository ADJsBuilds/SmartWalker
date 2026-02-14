import { formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import type { EventItem } from '@/lib/types';

export function EventTimeline({ events }: { events: EventItem[] }) {
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={severityVariant(event.severity)} className="capitalize">
              {event.type.replace('_', ' ')}
            </Badge>
            <p className="text-xs text-slate-400">{formatDistanceToNowStrict(new Date(event.ts), { addSuffix: true })}</p>
          </div>
          <p className="mt-2 text-xs text-slate-300">{JSON.stringify(event.payload)}</p>
        </div>
      ))}
    </div>
  );
}

function severityVariant(severity: string): 'danger' | 'warning' | 'secondary' {
  if (severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'secondary';
}

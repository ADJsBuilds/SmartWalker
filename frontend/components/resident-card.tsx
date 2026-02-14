import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { AlertItem, DailyStat, EventItem, Resident } from '@/lib/types';

export function ResidentCard({
  resident,
  todayStat,
  latestEvent,
  activeAlerts,
  onSendCheckin,
  onAdjustGoal,
}: {
  resident: Resident;
  todayStat?: DailyStat;
  latestEvent?: EventItem;
  activeAlerts: AlertItem[];
  onSendCheckin: (residentId: string) => void;
  onAdjustGoal: (residentId: string) => void;
}) {
  const steps = todayStat?.steps || 0;
  const goal = resident.daily_step_goal || 1;
  const progress = Math.min(100, Math.round((steps / goal) * 100));
  const adherence = todayStat?.adherence_percent ?? Math.min(100, progress);

  const status = activeAlerts.length
    ? activeAlerts.some((a) => a.severity === 'high')
      ? { label: 'Alert active', tone: 'danger' as const }
      : { label: 'Needs attention', tone: 'warning' as const }
    : { label: 'OK', tone: 'success' as const };

  const lastActive = latestEvent?.ts ? formatDistanceToNowStrict(new Date(latestEvent.ts), { addSuffix: true }) : 'No recent activity';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{resident.name}</CardTitle>
            <p className="text-sm text-slate-400">Room {resident.room}</p>
          </div>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-300">Last active: {lastActive}</p>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
            <span>Today steps</span>
            <span>
              {steps} / {goal}
            </span>
          </div>
          <Progress value={progress} />
        </div>
        <p className="text-sm text-slate-300">Adherence: {adherence}%</p>
        <div className="flex flex-wrap gap-1">
          {['fall', 'near_fall', 'inactivity', 'heavy_lean'].map((type) =>
            activeAlerts.some((a) => a.type === type) ? (
              <Badge key={type} variant="danger" className="capitalize">
                {type.replace('_', ' ')}
              </Badge>
            ) : null,
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/caregiver/residents/${resident.id}`}>
            <Button size="sm">Open profile</Button>
          </Link>
          <Button size="sm" variant="secondary" onClick={() => onSendCheckin(resident.id)}>
            Send check-in
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdjustGoal(resident.id)}>
            Adjust goal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

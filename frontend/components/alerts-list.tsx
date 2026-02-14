'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AlertItem, EventItem, Resident } from '@/lib/types';

type AlertWithRelations = AlertItem & { resident?: Resident; event?: EventItem };

export function AlertsList({ initialAlerts }: { initialAlerts: AlertWithRelations[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);

  const sorted = useMemo(
    () =>
      [...alerts].sort((a, b) => rank(b.severity) - rank(a.severity) || +new Date(b.created_at) - +new Date(a.created_at)),
    [alerts],
  );

  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('alerts-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, async () => {
        const { data } = await supabase.from('alerts').select('*, residents(*), events(*)').order('created_at', { ascending: false });
        setAlerts(
          ((data || []) as Array<Record<string, unknown>>).map((item) => ({
            ...(item as unknown as AlertItem),
            resident: (item.residents as Resident) || undefined,
            event: (item.events as EventItem) || undefined,
          })),
        );
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function updateStatus(id: string, action: 'ack' | 'resolve') {
    await fetch(`/api/alerts/${id}/${action}`, { method: 'POST' });
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: action === 'ack' ? 'acknowledged' : 'resolved' } : a)));
  }

  async function sendCheckin(residentId: string) {
    await fetch('/api/checkins/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ residentId, promptType: 'feeling', promptBody: 'How are you feeling?' }),
    });
  }

  return (
    <div className="space-y-3">
      {sorted.map((alert) => (
        <Card key={alert.id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="capitalize">{alert.type.replace('_', ' ')}</CardTitle>
              <div className="flex gap-1">
                <Badge variant={alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'secondary'}>{alert.severity}</Badge>
                <Badge variant={alert.status === 'active' ? 'danger' : alert.status === 'acknowledged' ? 'warning' : 'success'}>{alert.status}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-200">{alert.resident?.name || 'Unknown resident'}</p>
            <p className="text-xs text-slate-400">{formatDistanceToNowStrict(new Date(alert.created_at), { addSuffix: true })}</p>
            <p className="mt-2 text-xs text-slate-300">{JSON.stringify(alert.event?.payload || {})}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => updateStatus(alert.id, 'ack')}>
                Acknowledge
              </Button>
              <Button size="sm" variant="outline" onClick={() => updateStatus(alert.id, 'resolve')}>
                Resolve
              </Button>
              <Link href={`/caregiver/residents/${alert.resident_id}`}>
                <Button size="sm">Open resident</Button>
              </Link>
              <Button size="sm" variant="secondary" onClick={() => sendCheckin(alert.resident_id)}>
                Send check-in
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function rank(s: string): number {
  if (s === 'high') return 3;
  if (s === 'medium') return 2;
  return 1;
}

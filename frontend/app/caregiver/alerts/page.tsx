import { AlertsList } from '@/components/alerts-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getAlerts } from '@/lib/data';
import { getResidents } from '@/lib/data';

export default async function AlertsPage() {
  const alerts = await getAlerts();
  const residents = await getResidents();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <p className="text-sm text-slate-300">Realtime triage inbox</p>
            <p className="text-xs text-slate-400">New alerts appear automatically from Supabase Realtime.</p>
          </div>
          <form
            action="/api/events/simulate-fall"
            method="post"
            className="flex items-center gap-2"
          >
            <select name="residentId" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="destructive">
              Simulate fall
            </Button>
          </form>
        </CardContent>
      </Card>
      <AlertsList initialAlerts={alerts} />
    </div>
  );
}

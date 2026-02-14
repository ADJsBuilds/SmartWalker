'use client';

import { useState } from 'react';
import { ResidentCard } from '@/components/resident-card';
import { CheckInComposer } from '@/components/checkin-modal';
import { Button } from '@/components/ui/button';
import type { AlertItem, DailyStat, EventItem, Resident } from '@/lib/types';

interface OverviewData {
  residents: Resident[];
  statsByResident: Record<string, DailyStat | undefined>;
  latestEventByResident: Record<string, EventItem | undefined>;
  activeAlertsByResident: Record<string, AlertItem[]>;
}

export function CaregiverOverview({ data }: { data: OverviewData }) {
  const [selectedResidentForCheckin, setSelectedResidentForCheckin] = useState<string | null>(null);

  async function adjustGoal(residentId: string) {
    const raw = window.prompt('New daily step goal');
    if (!raw) return;
    const dailyStepGoal = Number(raw);
    if (!Number.isFinite(dailyStepGoal) || dailyStepGoal <= 0) return;
    await fetch(`/api/residents/${residentId}/goal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyStepGoal }),
    });
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      {selectedResidentForCheckin ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Check-in Composer</p>
            <Button variant="outline" size="sm" onClick={() => setSelectedResidentForCheckin(null)}>
              Close
            </Button>
          </div>
          <CheckInComposer residentId={selectedResidentForCheckin} onSent={() => setSelectedResidentForCheckin(null)} />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.residents.map((resident) => (
          <ResidentCard
            key={resident.id}
            resident={resident}
            todayStat={data.statsByResident[resident.id]}
            latestEvent={data.latestEventByResident[resident.id]}
            activeAlerts={data.activeAlertsByResident[resident.id] || []}
            onSendCheckin={setSelectedResidentForCheckin}
            onAdjustGoal={adjustGoal}
          />
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function AssignPlan({
  residentId,
  plans,
  onAssigned,
}: {
  residentId: string;
  plans: Array<{ id: string; title: string }>;
  onAssigned?: () => void;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [loading, setLoading] = useState(false);

  async function assign() {
    if (!planId) return;
    setLoading(true);
    await fetch('/api/plans/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ residentIds: [residentId], planId }),
    });
    setLoading(false);
    onAssigned?.();
    window.location.reload();
  }

  return (
    <div className="flex items-center gap-2">
      <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
        {plans.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {plan.title}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={assign} disabled={loading || !planId}>
        Assign
      </Button>
    </div>
  );
}

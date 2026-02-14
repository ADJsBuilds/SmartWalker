import { PlanForm } from '@/components/plan-form';
import { AssignPlan } from '@/components/assign-plan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPlans, getResidents } from '@/lib/data';

export default async function PlansPage() {
  const [plans, residents] = await Promise.all([getPlans(), getResidents()]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PlanForm />
      <Card>
        <CardHeader>
          <CardTitle>Assign Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {residents.map((resident) => (
            <div key={resident.id} className="flex items-center justify-between rounded-md border border-slate-800 p-2">
              <div>
                <p className="font-medium">{resident.name}</p>
                <p className="text-xs text-slate-400">Room {resident.room}</p>
              </div>
              <AssignPlan residentId={resident.id} plans={plans.map((p) => ({ id: p.id, title: p.title }))} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Existing Plans</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-md border border-slate-800 bg-slate-950 p-3">
              <p className="font-semibold">{plan.title}</p>
              <p className="text-sm text-slate-300">Daily goal: {plan.daily_step_goal}</p>
              <pre className="mt-2 overflow-auto text-xs text-slate-400">{JSON.stringify(plan.exercises, null, 2)}</pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

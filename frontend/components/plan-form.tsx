'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function PlanForm({ onCreated }: { onCreated?: () => void }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('300');
  const [exerciseText, setExerciseText] = useState('Sit-to-stand,10,2x/day\nHeel raises,12,1x/day');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const exercises = exerciseText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, reps, frequency] = line.split(',').map((x) => x.trim());
        return { name: name || 'Exercise', reps: reps || '-', frequency: frequency || '-' };
      });
    await fetch('/api/plans/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dailyStepGoal: Number(goal), exercises }),
    });
    setLoading(false);
    setTitle('');
    onCreated?.();
    window.location.reload();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="font-semibold">Create Plan</h3>
      <Input placeholder="Plan title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input placeholder="Daily steps suggestion" type="number" value={goal} onChange={(e) => setGoal(e.target.value)} required />
      <Textarea value={exerciseText} onChange={(e) => setExerciseText(e.target.value)} />
      <p className="text-xs text-slate-400">One exercise per line: name,reps,frequency</p>
      <Button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Plan'}
      </Button>
    </form>
  );
}

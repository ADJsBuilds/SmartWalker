'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function CheckInComposer({ residentId, onSent }: { residentId: string; onSent?: () => void }) {
  const [promptType, setPromptType] = useState<'feeling' | 'exercise'>('feeling');
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(false);

  const prompt =
    custom.trim() ||
    (promptType === 'feeling' ? 'How are you feeling?' : 'Did you complete exercises?');

  async function send() {
    setLoading(true);
    await fetch('/api/checkins/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ residentId, promptType, promptBody: prompt }),
    });
    setLoading(false);
    setCustom('');
    onSent?.();
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <p className="text-sm font-semibold">Send check-in</p>
      <div className="flex gap-2">
        <Button size="sm" variant={promptType === 'feeling' ? 'default' : 'secondary'} onClick={() => setPromptType('feeling')}>
          How are you feeling?
        </Button>
        <Button size="sm" variant={promptType === 'exercise' ? 'default' : 'secondary'} onClick={() => setPromptType('exercise')}>
          Did you complete exercises?
        </Button>
      </div>
      <Textarea placeholder="Optional custom prompt" value={custom} onChange={(e) => setCustom(e.target.value)} />
      <Button size="sm" onClick={send} disabled={loading}>
        {loading ? 'Sending...' : 'Send Check-in'}
      </Button>
    </div>
  );
}

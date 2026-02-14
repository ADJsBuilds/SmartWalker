import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const contentType = req.headers.get('content-type') || '';

  let residentId = '';
  if (contentType.includes('application/json')) {
    const json = await req.json();
    residentId = json.residentId;
  } else {
    const form = await req.formData();
    residentId = String(form.get('residentId') || '');
  }

  if (!residentId) return NextResponse.json({ ok: false, error: 'residentId required' }, { status: 400 });

  const { error } = await supabase.from('events').insert({
    resident_id: residentId,
    type: 'fall',
    severity: 'high',
    payload: { source: 'simulate_button', note: 'Simulated fall for demo' },
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.redirect(new URL('/caregiver/alerts', req.url));
}

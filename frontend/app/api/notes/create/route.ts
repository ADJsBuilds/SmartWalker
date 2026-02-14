import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const DEMO_CAREGIVER_ID = '00000000-0000-0000-0000-000000000001';

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const body = await req.json();
  const residentId = body.residentId as string;
  const text = String(body.body || '').trim();
  if (!residentId || !text) return NextResponse.json({ ok: false, error: 'residentId and body required' }, { status: 400 });
  const { error } = await supabase.from('notes').insert({ resident_id: residentId, caregiver_id: DEMO_CAREGIVER_ID, body: text });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

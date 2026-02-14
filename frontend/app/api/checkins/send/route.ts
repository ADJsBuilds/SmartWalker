import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const DEMO_CAREGIVER_ID = '00000000-0000-0000-0000-000000000001';

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const body = await req.json();
  const residentId = body.residentId as string;
  const promptType = body.promptType as string;
  const promptBody = body.promptBody as string;
  if (!residentId || !promptType || !promptBody) {
    return NextResponse.json({ ok: false, error: 'residentId, promptType, promptBody required' }, { status: 400 });
  }
  const { error } = await supabase.from('checkins').insert({
    resident_id: residentId,
    caregiver_id: DEMO_CAREGIVER_ID,
    prompt_type: promptType,
    prompt_body: promptBody,
    status: 'sent',
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

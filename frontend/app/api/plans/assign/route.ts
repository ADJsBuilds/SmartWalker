import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const body = await req.json();
  const planId = body.planId as string;
  const residentIds = body.residentIds as string[];
  if (!planId || !Array.isArray(residentIds) || !residentIds.length) {
    return NextResponse.json({ ok: false, error: 'planId and residentIds required' }, { status: 400 });
  }
  const { error } = await supabase.from('residents').update({ plan_id: planId }).in('id', residentIds);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

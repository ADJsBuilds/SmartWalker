import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createAdminClient();
  const body = await req.json();
  const responseBody = String(body.responseBody || '').trim();
  if (!responseBody) return NextResponse.json({ ok: false, error: 'responseBody required' }, { status: 400 });
  const { error } = await supabase
    .from('checkins')
    .update({ status: 'responded', response_body: responseBody, responded_at: new Date().toISOString() })
    .eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

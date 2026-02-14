import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRole) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

const eventTypes = ['fall', 'near_fall', 'inactivity', 'heavy_lean', 'steps_update'] as const;
const severities = { fall: 'high', near_fall: 'medium', inactivity: 'medium', heavy_lean: 'low', steps_update: 'low' } as const;

function randomOf<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function tick() {
  const { data: residents, error } = await supabase.from('residents').select('id').limit(5);
  if (error || !residents?.length) {
    console.error('No residents found or query failed:', error?.message);
    return;
  }

  const residentId = randomOf(residents).id as string;
  const type = randomOf(eventTypes);
  const severity = severities[type];
  const payload =
    type === 'steps_update'
      ? { steps: 40 + Math.floor(Math.random() * 60), walking_minutes: 8 + Math.floor(Math.random() * 15) }
      : type === 'fall'
        ? { tiltDeg: 67, note: 'simulated fall event' }
        : type === 'near_fall'
          ? { tiltDeg: 48, recovered: true }
          : type === 'inactivity'
            ? { minutes_inactive: 70 + Math.floor(Math.random() * 40) }
            : { lean_ratio: Math.round((0.55 + Math.random() * 0.2) * 100) / 100 };

  const { error: insertError } = await supabase.from('events').insert({
    resident_id: residentId,
    type,
    severity,
    payload,
  });

  if (insertError) {
    console.error('Insert event failed:', insertError.message);
  } else {
    console.log(`[sim] resident=${residentId} type=${type} severity=${severity}`);
  }
}

async function run() {
  console.log('Starting SmartWalker event simulator (Ctrl+C to stop)');
  while (true) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

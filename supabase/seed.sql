-- Caregiver demo seed data
insert into caregivers (id, name, role) values
('00000000-0000-0000-0000-000000000001', 'Demo Caregiver', 'caregiver'),
('00000000-0000-0000-0000-000000000002', 'Demo Physio', 'physio')
on conflict (id) do nothing;

insert into plans (id, title, daily_step_goal, exercises) values
('10000000-0000-0000-0000-000000000001', 'Mobility Starter', 280, '[{"name":"Sit-to-stand","reps":"10","frequency":"2x/day"},{"name":"Heel raises","reps":"12","frequency":"1x/day"}]'),
('10000000-0000-0000-0000-000000000002', 'Balance Builder', 350, '[{"name":"March in place","reps":"45 sec","frequency":"2x/day"},{"name":"Side steps","reps":"12","frequency":"2x/day"}]')
on conflict (id) do nothing;

insert into residents (id, name, room, daily_step_goal, plan_id) values
('20000000-0000-0000-0000-000000000001', 'Martha Lee', 'A101', 280, '10000000-0000-0000-0000-000000000001'),
('20000000-0000-0000-0000-000000000002', 'Thomas Reed', 'A102', 320, '10000000-0000-0000-0000-000000000001'),
('20000000-0000-0000-0000-000000000003', 'Irene Patel', 'B201', 360, '10000000-0000-0000-0000-000000000002'),
('20000000-0000-0000-0000-000000000004', 'George Kim', 'B203', 240, null),
('20000000-0000-0000-0000-000000000005', 'Elena Lopez', 'C110', 300, '10000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into daily_stats (resident_id, date, steps, walking_minutes, adherence_percent) values
('20000000-0000-0000-0000-000000000001', current_date, 210, 34, 75),
('20000000-0000-0000-0000-000000000002', current_date, 152, 22, 48),
('20000000-0000-0000-0000-000000000003', current_date, 305, 43, 84),
('20000000-0000-0000-0000-000000000004', current_date, 95, 14, 40),
('20000000-0000-0000-0000-000000000005', current_date, 267, 39, 89),
('20000000-0000-0000-0000-000000000001', current_date - 1, 255, 38, 91),
('20000000-0000-0000-0000-000000000002', current_date - 1, 298, 41, 93),
('20000000-0000-0000-0000-000000000003', current_date - 1, 280, 40, 78),
('20000000-0000-0000-0000-000000000004', current_date - 1, 168, 24, 70),
('20000000-0000-0000-0000-000000000005', current_date - 1, 310, 45, 100)
on conflict (resident_id, date) do update set
steps = excluded.steps,
walking_minutes = excluded.walking_minutes,
adherence_percent = excluded.adherence_percent;

insert into events (resident_id, type, severity, ts, payload) values
('20000000-0000-0000-0000-000000000002', 'near_fall', 'medium', now() - interval '2 hours', '{"tiltDeg": 48, "note":"Recovered quickly"}'),
('20000000-0000-0000-0000-000000000004', 'inactivity', 'medium', now() - interval '3 hours', '{"minutes_inactive": 95}'),
('20000000-0000-0000-0000-000000000003', 'heavy_lean', 'low', now() - interval '90 minutes', '{"lean_ratio": 0.63}'),
('20000000-0000-0000-0000-000000000001', 'steps_update', 'low', now() - interval '5 minutes', '{"steps":210}')
on conflict do nothing;

insert into notes (resident_id, caregiver_id, body) values
('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Encourage longer warm-up before afternoon walk.'),
('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Improved gait symmetry compared with yesterday.')
on conflict do nothing;

insert into checkins (resident_id, caregiver_id, prompt_type, prompt_body, status, response_body, responded_at) values
('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'feeling', 'How are you feeling?', 'responded', 'Feeling okay, slight knee stiffness.', now() - interval '1 hour'),
('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'exercise', 'Did you complete exercises?', 'sent', null, null)
on conflict do nothing;

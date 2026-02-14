export type AlertType = 'fall' | 'near_fall' | 'inactivity' | 'heavy_lean';
export type EventType = AlertType | 'steps_update';

export interface Resident {
  id: string;
  name: string;
  room: string;
  avatar_url: string | null;
  daily_step_goal: number;
  plan_id: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  title: string;
  daily_step_goal: number;
  exercises: Array<{ name: string; reps: string; frequency: string }>;
  created_at: string;
}

export interface EventItem {
  id: string;
  resident_id: string;
  type: EventType;
  severity: 'high' | 'medium' | 'low';
  ts: string;
  payload: Record<string, unknown>;
}

export interface AlertItem {
  id: string;
  resident_id: string;
  event_id: string | null;
  type: AlertType;
  severity: 'high' | 'medium' | 'low';
  status: 'active' | 'acknowledged' | 'resolved';
  created_at: string;
  updated_at: string;
}

export interface DailyStat {
  id: string;
  resident_id: string;
  date: string;
  steps: number;
  walking_minutes: number;
  adherence_percent: number;
}

export interface Note {
  id: string;
  resident_id: string;
  caregiver_id: string;
  body: string;
  created_at: string;
}

export interface CheckIn {
  id: string;
  resident_id: string;
  caregiver_id: string;
  prompt_type: string;
  prompt_body: string;
  status: 'sent' | 'responded';
  sent_at: string;
  response_body: string | null;
  responded_at: string | null;
}

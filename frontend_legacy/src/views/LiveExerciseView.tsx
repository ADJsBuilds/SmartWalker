import { UserView } from './UserView';

export function LiveExerciseView() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Live Exercise</h2>
      <p className="text-sm text-slate-400">
        Your AI coach will guide you through exercises. Connect to start.
      </p>
      <UserView />
    </div>
  );
}

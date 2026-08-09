// Shared progress status constants for dashboard, tracking and configuration.
// These map the existing DB status values (progress_cells.status) to the UI
// labels and colors shown in the reference screenshots.

export const PROGRESS_STATUS = {
  not_started: { key: "not_started", label: "Yet to start", color: "#ef4444", bg: "bg-red-500", text: "text-white" },
  in_progress: { key: "in_progress", label: "In progress", color: "#eab308", bg: "bg-yellow-500", text: "text-white" },
  on_hold: { key: "on_hold", label: "Patch work", color: "#3b82f6", bg: "bg-blue-500", text: "text-white" },
  completed: { key: "completed", label: "Completed", color: "#22c55e", bg: "bg-green-500", text: "text-white" },
} as const;

export type ProgressStatusKey = keyof typeof PROGRESS_STATUS;

export const PROGRESS_STATUS_KEYS: ProgressStatusKey[] = ["not_started", "in_progress", "on_hold", "completed"];

export function getStatusInfo(key: string) {
  return PROGRESS_STATUS[(key as ProgressStatusKey) ?? "not_started"] ?? PROGRESS_STATUS.not_started;
}

export function statusLabel(key: string): string {
  return getStatusInfo(key).label;
}

export function statusClasses(key: string): string {
  const info = getStatusInfo(key);
  return `${info.bg} ${info.text}`;
}

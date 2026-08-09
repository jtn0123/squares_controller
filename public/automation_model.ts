const DAY_PRESETS: Record<string, readonly number[]> = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [0, 1, 2, 3, 4],
  weekends: [5, 6],
};

// Automations as returned by /api/automations. The server assigns id and
// enabled; kind selects which schedule fields are present (runAt for
// "once" items, time/days for "daily" items).
export interface AutomationItem {
  id: string;
  enabled: boolean;
  name: string;
  kind: "once" | "daily";
  action: string;
  runAt?: string;
  time?: string;
  days?: number[];
  value?: number;
}

// A client-built automation posted to the server, which assigns id/enabled.
export type AutomationDraft = Omit<AutomationItem, "id" | "enabled">;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateTime(date: Date): string {
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

export function buildSleepAutomation(
  rawMinutes: number | string,
  now: Date = new Date(),
): AutomationDraft {
  const minutes = Number(rawMinutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("Sleep timer must be from 1 to 1440 minutes.");
  }
  const runAt = new Date(now.getTime() + minutes * 60_000);
  return {
    name: `SLEEP IN ${minutes} MIN`,
    kind: "once",
    runAt: localDateTime(runAt),
    action: "off",
  };
}

export function daysForPreset(preset: string): number[] {
  return [...(DAY_PRESETS[preset] ?? DAY_PRESETS.daily)];
}

function dayLabel(days: readonly number[]): string {
  const key = Object.entries(DAY_PRESETS).find(
    ([, values]) =>
      values.length === days.length &&
      values.every((value, index) => value === days[index]),
  )?.[0];
  if (key === "weekdays") return "WEEKDAYS";
  if (key === "weekends") return "WEEKENDS";
  return "DAILY";
}

function actionLabel(item: AutomationItem): string {
  const action = String(item.action ?? "").toUpperCase();
  return ["WAKE", "BRIGHTNESS"].includes(action)
    ? `${action} ${item.value}%`
    : action;
}

export function describeAutomation(item: AutomationItem): string {
  if (item.kind === "daily") {
    // Daily items always carry days/time from the server.
    return `${dayLabel(item.days!)} / ${item.time} / ${actionLabel(item)}`;
  }
  // Once items always carry runAt from the server.
  const date = new Date(item.runAt!);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .toUpperCase();
  return `ONCE / ${dateLabel} / ${actionLabel(item)}`;
}

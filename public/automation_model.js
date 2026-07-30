const DAY_PRESETS = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [0, 1, 2, 3, 4],
  weekends: [5, 6],
};

function pad(value) {
  return String(value).padStart(2, "0");
}

export function localDateTime(date) {
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

export function buildSleepAutomation(rawMinutes, now = new Date()) {
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

export function daysForPreset(preset) {
  return [...(DAY_PRESETS[preset] ?? DAY_PRESETS.daily)];
}

function dayLabel(days) {
  const key = Object.entries(DAY_PRESETS).find(
    ([, values]) =>
      values.length === days.length &&
      values.every((value, index) => value === days[index]),
  )?.[0];
  if (key === "weekdays") return "WEEKDAYS";
  if (key === "weekends") return "WEEKENDS";
  return "DAILY";
}

function actionLabel(item) {
  const action = String(item.action ?? "").toUpperCase();
  return ["WAKE", "BRIGHTNESS"].includes(action)
    ? `${action} ${item.value}%`
    : action;
}

export function describeAutomation(item) {
  if (item.kind === "daily") {
    return `${dayLabel(item.days)} / ${item.time} / ${actionLabel(item)}`;
  }
  const date = new Date(item.runAt);
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

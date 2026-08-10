import { $ } from "./dom.js";
import { state } from "./app_state.js";
import { api, toast } from "./net.js";
import {
  buildSleepAutomation,
  daysForPreset,
  describeAutomation,
  localDateTime,
} from "./automation_model.js";
import type { AutomationDraft, AutomationItem } from "./automation_model.js";

interface RuntimePolicy {
  startupAction: string;
  frameLossAction: string;
  frameLossSeconds: number;
}

function renderAutomations(): void {
  const list = $("#automationList");
  list.replaceChildren();
  state.automations.forEach((automation) => {
    const row = document.createElement("div");
    row.className = "automation-row";
    row.classList.toggle("inactive", !automation.enabled);
    const copy = document.createElement("div");
    copy.className = "automation-copy";
    const name = document.createElement("strong");
    name.textContent = automation.name;
    const detail = document.createElement("small");
    detail.textContent = describeAutomation(automation);
    copy.append(name, detail);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = automation.enabled ? "PAUSE" : "ARM";
    toggle.setAttribute(
      "aria-label",
      `${automation.enabled ? "Pause" : "Arm"} ${automation.name}`,
    );
    toggle.addEventListener("click", async () => {
      try {
        await api("/api/automations", {
          method: "POST",
          body: JSON.stringify({ ...automation, enabled: !automation.enabled }),
        });
        await loadAutomations();
      } catch (error) {
        toast((error as Error).message, true);
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${automation.name}`);
    remove.addEventListener("click", async () => {
      try {
        await api(`/api/automations/${encodeURIComponent(automation.id)}`, {
          method: "DELETE",
        });
        await loadAutomations();
        toast(`Deleted ${automation.name}.`);
      } catch (error) {
        toast((error as Error).message, true);
      }
    });
    row.append(copy, toggle, remove);
    list.append(row);
  });
}

export async function loadAutomations(): Promise<void> {
  const response = await api<{ automations?: AutomationItem[] }>(
    "/api/automations",
  );
  state.automations = Array.isArray(response.automations)
    ? response.automations
    : [];
  renderAutomations();
}

async function saveAutomation(automation: AutomationDraft): Promise<void> {
  await api("/api/automations", {
    method: "POST",
    body: JSON.stringify(automation),
  });
  await loadAutomations();
}

function updateAutomationValueState(): void {
  const action = $<HTMLSelectElement>("#automationAction").value;
  const input = $<HTMLInputElement>("#automationValue");
  input.disabled = !["wake", "brightness"].includes(action);
}

export function initializeAutomations(): void {
  $<HTMLInputElement>("#wakeAt").value = localDateTime(
    new Date(Date.now() + 8 * 60 * 60 * 1000),
  );
  $("#automationAction").addEventListener("change", updateAutomationValueState);
  updateAutomationValueState();

  $("#scheduleSleepButton").addEventListener("click", async () => {
    try {
      const automation = buildSleepAutomation(
        $<HTMLInputElement>("#sleepMinutes").value,
      );
      await saveAutomation(automation);
      toast(`${automation.name} armed.`);
    } catch (error) {
      toast((error as Error).message, true);
    }
  });

  $("#scheduleWakeButton").addEventListener("click", async () => {
    const runAt = $<HTMLInputElement>("#wakeAt").value;
    const value = Number($<HTMLInputElement>("#wakeBrightness").value);
    if (!runAt || new Date(runAt).getTime() <= Date.now()) {
      toast("Choose a future wake time.", true);
      return;
    }
    try {
      await saveAutomation({
        name: "WAKE",
        kind: "once",
        runAt,
        action: "wake",
        value,
      });
      toast("Wake action armed.");
    } catch (error) {
      toast((error as Error).message, true);
    }
  });

  $("#saveAutomationButton").addEventListener("click", async () => {
    const action = $<HTMLSelectElement>("#automationAction").value;
    const time = $<HTMLInputElement>("#automationTime").value;
    const nameInput = $<HTMLInputElement>("#automationName");
    const name =
      nameInput.value.trim().toUpperCase() ||
      `DAILY ${action.toUpperCase()}`;
    const automation: AutomationDraft = {
      name,
      kind: "daily",
      time,
      days: daysForPreset($<HTMLSelectElement>("#automationDays").value),
      action,
      ...(["wake", "brightness"].includes(action)
        ? { value: Number($<HTMLInputElement>("#automationValue").value) }
        : {}),
    };
    try {
      await saveAutomation(automation);
      nameInput.value = "";
      toast(`Saved ${name}.`);
    } catch (error) {
      toast((error as Error).message, true);
    }
  });

  void loadAutomations().catch((error: Error) =>
    toast(`Automation unavailable: ${error.message}`, true),
  );
}

function renderRuntimePolicy(policy: RuntimePolicy): void {
  $<HTMLSelectElement>("#startupAction").value = policy.startupAction;
  $<HTMLSelectElement>("#frameLossAction").value = policy.frameLossAction;
  $<HTMLInputElement>("#frameLossSeconds").value = String(
    policy.frameLossSeconds,
  );
  const startup =
    policy.startupAction === "unchanged"
      ? "START UNCHANGED"
      : `START ${policy.startupAction.toUpperCase()}`;
  const frameLoss =
    policy.frameLossAction === "hold"
      ? "LOSS HOLD"
      : `LOSS ${policy.frameLossAction.toUpperCase()}`;
  $("#runtimePolicyStatus").textContent = `${startup} / ${frameLoss}`;
}

async function loadRuntimePolicy(): Promise<void> {
  const response = await api<{ runtimePolicy: RuntimePolicy }>(
    "/api/runtime-policy",
  );
  renderRuntimePolicy(response.runtimePolicy);
}

export function initializeRuntimePolicy(): void {
  $("#saveRuntimePolicy").addEventListener("click", async () => {
    try {
      const response = await api<{ runtimePolicy: RuntimePolicy }>(
        "/api/runtime-policy",
        {
          method: "POST",
          body: JSON.stringify({
            startupAction: $<HTMLSelectElement>("#startupAction").value,
            frameLossAction: $<HTMLSelectElement>("#frameLossAction").value,
            frameLossSeconds: Number(
              $<HTMLInputElement>("#frameLossSeconds").value,
            ),
          }),
        },
      );
      renderRuntimePolicy(response.runtimePolicy);
      toast("Runtime policy saved.");
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
  void loadRuntimePolicy().catch((error: Error) =>
    toast(`Runtime policy unavailable: ${error.message}`, true),
  );
}

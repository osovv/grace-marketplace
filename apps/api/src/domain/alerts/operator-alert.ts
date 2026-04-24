import { auditLog } from "../../lib/audit.js";
import { appConfig } from "../../config.js";

type SendOperatorAlertInput = {
  tgId: string;
  userId: string;
  reason: string;
  source: string;
  triggerCode?: string;
  medicalStatus?: string;
  age?: number | null;
  gender?: string | null;
  required?: boolean;
};

export async function sendOperatorEscalationAlert(input: SendOperatorAlertInput): Promise<void> {
  const botToken = appConfig.tgAlertBotToken;
  const operatorChatId = appConfig.tgOperatorChatId;
  const isRequired = input.required ?? false;

  if (!botToken || !operatorChatId) {
    auditLog("M-026", "sendOperatorEscalationAlert", "SKIP", "Operator alert skipped: missing env config", {
      hasToken: Boolean(botToken),
      hasChat: Boolean(operatorChatId),
    });
    if (isRequired) {
      throw new Error("Operator alert config is missing");
    }
    return;
  }

  const text = [
    "MEDICAL ESCALATION ALERT",
    `UserId: ${input.userId}`,
    `TgId: ${input.tgId}`,
    `Reason: ${input.reason}`,
    `Source: ${input.source}`,
    `Trigger: ${input.triggerCode ?? "-"}`,
    `MedicalStatus: ${input.medicalStatus ?? "-"}`,
    `Age: ${input.age ?? "-"}`,
    `Gender: ${input.gender ?? "-"}`,
  ].join("\n");

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: operatorChatId,
        text,
        disable_notification: false,
      }),
    });
  } catch (error) {
    auditLog("M-026", "sendOperatorEscalationAlert", "ERROR", "Failed to deliver operator alert", {
      userId: input.userId,
      transportError: error instanceof Error ? error.message : "unknown",
    });
    if (isRequired) {
      throw new Error("Operator alert delivery failed");
    }
    return;
  }

  if (!response.ok) {
    auditLog("M-026", "sendOperatorEscalationAlert", "ERROR", "Failed to deliver operator alert", {
      status: response.status,
      userId: input.userId,
    });
    if (isRequired) {
      throw new Error(`Operator alert failed with status ${response.status}`);
    }
    return;
  }

  auditLog("M-026", "sendOperatorEscalationAlert", "DELIVER", "Operator alert delivered", {
    userId: input.userId,
    operatorChatId,
  });
}

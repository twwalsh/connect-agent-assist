/**
 * Starts a chat contact in Amazon Connect for a web visitor and returns the participant credentials
 * the browser needs for amazon-connect-chatjs. Called only by the twwalsh.com Worker (which has already
 * verified a Turnstile token) and authenticated with a shared key; fails closed without it.
 * The visitor's question and the self-service assistant's answer travel as contact attributes, so the
 * agent and the assist Lambda see the context the moment the contact lands in queue.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ConnectClient, StartChatContactCommand } from "@aws-sdk/client-connect";
import { cleanQuestion } from "./rag.js";

const client = new ConnectClient({});
const INSTANCE_ID = process.env.INSTANCE_ID ?? "";
const CONTACT_FLOW_ID = process.env.CONTACT_FLOW_ID ?? "";
const START_KEY = process.env.START_KEY ?? "";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext.http.method !== "POST") return json(405, { error: "POST only" });
  if (!START_KEY || !INSTANCE_ID || !CONTACT_FLOW_ID) return json(503, { error: "chat not configured" });
  if ((event.headers?.["x-start-key"] ?? "") !== START_KEY) return json(403, { error: "forbidden" });
  let body: { displayName?: unknown; question?: unknown; botAnswer?: unknown } = {};
  try { body = JSON.parse(event.body ?? "{}"); } catch { return json(400, { error: "bad json" }); }
  const displayName = (typeof body.displayName === "string" && body.displayName.trim().slice(0, 40)) || "Visitor";
  const question = cleanQuestion(body.question) ?? "";
  const botAnswer = typeof body.botAnswer === "string" ? body.botAnswer.replace(/\s+/g, " ").trim().slice(0, 1500) : "";
  const res = await client.send(new StartChatContactCommand({
    InstanceId: INSTANCE_ID,
    ContactFlowId: CONTACT_FLOW_ID,
    ParticipantDetails: { DisplayName: displayName },
    Attributes: { channel: "twwalsh.com", question, botAnswer },
    SupportedMessagingContentTypes: ["text/plain", "text/markdown"],
    ClientToken: event.requestContext.requestId,
  }));
  return json(200, { contactId: res.ContactId, participantId: res.ParticipantId, participantToken: res.ParticipantToken });
};

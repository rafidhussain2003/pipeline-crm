// Conversation memory for the AI assistant (Part 1). Reuses the existing
// cache abstraction (src/lib/infra/cache.ts) rather than a third in-memory
// Map implementation in this codebase — the need (keyed, TTL-bounded,
// in-process storage) is identical to what the cache already provides.
import { cache } from "../infra/cache";

export type ConversationTurn = { role: "user" | "assistant"; content: string; at: string };

const MEMORY_TTL_MS = 30 * 60_000; // 30 minutes of idle conversation is forgotten
const MAX_TURNS = 20;

function memoryKey(userId: string): string {
  return `ai-memory:${userId}`;
}

export async function getConversationHistory(userId: string): Promise<ConversationTurn[]> {
  return (await cache.get<ConversationTurn[]>(memoryKey(userId))) || [];
}

export async function appendConversationTurn(userId: string, turn: ConversationTurn): Promise<void> {
  const history = await getConversationHistory(userId);
  const updated = [...history, turn].slice(-MAX_TURNS);
  await cache.set(memoryKey(userId), updated, MEMORY_TTL_MS);
}

export async function clearConversationHistory(userId: string): Promise<void> {
  await cache.delete(memoryKey(userId));
}

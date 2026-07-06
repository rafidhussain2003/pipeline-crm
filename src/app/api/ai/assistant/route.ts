import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { withRoute } from "@/lib/api-handler";
import { checkPolicy } from "@/lib/rate-limit";
import { askAssistant } from "@/lib/ai/assistant";

export async function POST(req: NextRequest) {
  return withRoute("ai.assistant", "POST", req, async (logger) => {
    const auth = await requireCompanySession();
    if (!auth.ok) return auth.response;
    logger.setContext({ userId: auth.session.userId, companyId: auth.session.companyId });

    const rl = checkPolicy("api.authenticated", auth.session.userId);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const answer = await askAssistant(auth.session.userId, auth.session.companyId, question);
    logger.info("assistant_answered", { matchedIntent: answer.matchedIntent, usedAI: answer.usedAI });
    return NextResponse.json(answer);
  });
}

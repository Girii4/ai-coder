import { getPrisma } from "@/lib/prisma";
import { z } from "zod";
import Together from "together-ai";

export async function POST(req: Request) {
  const prisma = getPrisma();
  const { messageId, model } = await req.json();

  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    return new Response(null, { status: 404 });
  }

  const messagesRes = await prisma.message.findMany({
    where: { chatId: message.chatId, position: { lte: message.position } },
    orderBy: { position: "asc" },
  });

  let messages = z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }),
    )
    .parse(messagesRes);

  if (messages.length > 10) {
    messages = [messages[0], messages[1], messages[2], ...messages.slice(-7)];
  }

  const rawTogetherKey = (process.env.TOGETHER_API_KEY || "").trim();
  const rawGeminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const isGemini = rawGeminiKey !== "" || rawTogetherKey.startsWith("AIzaSy") || rawTogetherKey.startsWith("AQ.");
  const apiKey = isGemini
    ? (rawGeminiKey !== "" ? rawGeminiKey : rawTogetherKey)
    : rawTogetherKey;

  let options: ConstructorParameters<typeof Together>[0] = {
    apiKey: apiKey,
  };

  if (isGemini) {
    options.baseURL = "https://generativelanguage.googleapis.com/v1beta/openai";
  } else if (process.env.HELICONE_API_KEY) {
    options.baseURL = "https://together.helicone.ai/v1";
    options.defaultHeaders = {
      "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
      "Helicone-Property-appname": "LlamaCoder",
      "Helicone-Session-Id": message.chatId,
      "Helicone-Session-Name": "LlamaCoder Chat",
    };
  }

  const together = new Together(options);

  const res = await together.chat.completions.create({
    model: isGemini ? "gemini-2.5-flash" : model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    temperature: 0.2,
    max_tokens: 9000,
  });

  return new Response(res.toReadableStream());
}

export const maxDuration = 45;

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createOrGetMonogramIcon } from "../../../../db/icons";
import { auth } from "../../../../lib/auth";
import {
  monogramTextFromIconId,
  normalizeMonogramAccent,
} from "../../../../lib/monogram-icon";

const MAX_REQUEST_BYTES = 2_048;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) throw new Error("请求内容过大");
    const body = await request.json() as { text?: unknown; accent?: unknown; color?: unknown };
    const requestedAccent = body.accent ?? body.color;
    const record = await createOrGetMonogramIcon(body.text, requestedAccent);
    if (!record?.catalog) throw new Error("字母图标创建失败");
    const text = monogramTextFromIconId(record.catalog.id);
    if (!text) throw new Error("字母图标创建失败");

    return NextResponse.json({
      icon: {
        iconId: record.catalog.id,
        iconKey: record.catalog.id,
        title: text,
        accent: normalizeMonogramAccent(record.catalog.accent, text),
        source: "monogram",
        sourceLabel: "字母图标",
        text,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "字母图标创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

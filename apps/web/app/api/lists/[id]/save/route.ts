import { json, requireUser, unavailable } from "../../../../../src/lib/api";
import { setListSaved } from "../../../../../src/lib/lists";

type Context = { params: Promise<{ id: string }> };

async function save(request: Request, { params }: Context, on: boolean): Promise<Response> {
  const id = (await params).id;
  const outcome = await requireUser(request, `/list/${id}`);
  if (!outcome.ok) return outcome.response;
  try {
    const result = await setListSaved(id, outcome.auth.userId, on);
    return result.ok ? json({ saved: on }) : json({ error: result.error }, { status: result.status });
  } catch {
    return unavailable();
  }
}

export function PUT(request: Request, context: Context) {
  return save(request, context, true);
}

export function DELETE(request: Request, context: Context) {
  return save(request, context, false);
}

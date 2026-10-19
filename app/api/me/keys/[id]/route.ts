import { badRequest, json, notFound, requireUser, unavailable } from "@/lib/api";
import { uuidParam } from "@/lib/core/params";
import { revokeMemberKey } from "@/lib/member-keys";

type Context = { params: Promise<{ id: string }> };

/** Revoke one of your keys. It stops working at once. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const id = uuidParam((await params).id);
  if (!id) return badRequest("That key id is not valid.");
  const outcome = await requireUser(request, "/me/keys");
  if (!outcome.ok) return outcome.response;
  try {
    return (await revokeMemberKey(outcome.auth.userId, id)) ? json({ revoked: true }) : notFound("That key could not be found.");
  } catch {
    return unavailable();
  }
}

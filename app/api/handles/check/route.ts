import { validateHandle } from "@/lib/core/people";
import { json, optionalUser, unavailable } from "@/lib/api";
import { isHandleAvailable } from "@/lib/profiles";

/** Live handle check: `?h=` → `{ handle, available, error? }`. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const validation = validateHandle(params.get("h") ?? params.get("handle"));
  if (!validation.ok) return json({ available: false, error: validation.error });
  try {
    const available = await isHandleAvailable(validation.handle, await optionalUser(request));
    return json({ handle: validation.handle, available, ...(available ? {} : { error: "That handle is taken." }) });
  } catch {
    return unavailable();
  }
}

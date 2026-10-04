import { validateHandle } from "@halalfood/core/social";
import { isHandleAvailable } from "../../../../src/lib/social-repository";
import { json, optionalUser } from "../../../../src/lib/api";
import { domainFailure } from "../../../../src/lib/domain-error";

/** Live handle check for the profile step: `{ available, error? }`. */
export async function GET(request: Request): Promise<Response> {
  const validation = validateHandle(new URL(request.url).searchParams.get("handle"));
  if (!validation.ok) return json({ available: false, error: validation.error });
  try {
    const userId = await optionalUser(request);
    const available = await isHandleAvailable(validation.handle, userId);
    return json({
      handle: validation.handle,
      available,
      ...(available ? {} : { error: "That handle is taken." }),
    });
  } catch (error) {
    return domainFailure("Checking that handle", error);
  }
}

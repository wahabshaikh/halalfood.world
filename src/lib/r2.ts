export const R2_BINDING_NAME = "HALAL_EVIDENCE_R2";
export const MAX_R2_UPLOAD_BYTES = 8 * 1024 * 1024;
export const R2_UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type R2UploadContentType = (typeof R2_UPLOAD_CONTENT_TYPES)[number];

export type R2BucketObject = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
};

export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: {
        contentType?: string;
        contentDisposition?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2BucketObject | null>;
  head(key: string): Promise<unknown | null>;
};

export type R2UploadValidation =
  | {
      ok: true;
      contentType: R2UploadContentType;
      sizeBytes: number;
      extension: "jpg" | "png" | "webp" | "pdf";
      fileName: string;
    }
  | { ok: false; error: string; status: 400 | 413 };

const EXTENSIONS: Record<
  R2UploadContentType,
  "jpg" | "png" | "webp" | "pdf"
> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function isUploadContentType(value: string): value is R2UploadContentType {
  return (R2_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value);
}

function normalizedFileName(value: unknown, extension: string): string {
  const raw = typeof value === "string" ? value : "";
  const base = raw.split(/[\\/]/).pop() || "";
  const clean = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .trim()
    .slice(0, 160);
  return clean || `halal-evidence.${extension}`;
}

function startsWithBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

/** Check the small set of signatures accepted by the upload endpoint. */
export function hasExpectedFileSignature(
  contentType: R2UploadContentType,
  bytes: Uint8Array,
): boolean {
  if (contentType === "image/jpeg") return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png")
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/webp")
    return (
      startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWithBytes(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
    );
  return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
}

export function validateR2UploadMetadata(input: {
  contentType: unknown;
  sizeBytes: unknown;
  fileName?: unknown;
}): R2UploadValidation {
  const contentType =
    typeof input.contentType === "string"
      ? input.contentType.trim().toLowerCase()
      : "";
  if (!isUploadContentType(contentType)) {
    return {
      ok: false,
      status: 400,
      error: "Upload a JPEG, PNG, WebP image, or PDF document.",
    };
  }
  if (
    typeof input.sizeBytes !== "number" ||
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 1
  ) {
    return { ok: false, status: 400, error: "The upload is empty or invalid." };
  }
  if (input.sizeBytes > MAX_R2_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Uploads must be 8 MiB or smaller.",
    };
  }
  const extension = EXTENSIONS[contentType] as "jpg" | "png" | "webp" | "pdf";
  return {
    ok: true,
    contentType,
    sizeBytes: input.sizeBytes,
    extension,
    fileName: normalizedFileName(input.fileName, extension),
  };
}

export function validateR2UploadFile(input: {
  contentType: unknown;
  sizeBytes: unknown;
  fileName?: unknown;
  bytes: Uint8Array;
}): R2UploadValidation {
  const metadata = validateR2UploadMetadata(input);
  if (!metadata.ok) return metadata;
  if (!hasExpectedFileSignature(metadata.contentType, input.bytes)) {
    return {
      ok: false,
      status: 400,
      error: "The upload content does not match its declared file type.",
    };
  }
  return metadata;
}

async function ownerHash(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function evidenceOwnerPrefix(userId: string): Promise<string> {
  return `community-verification/${await ownerHash(userId)}/`;
}

export const SAFE_R2_KEY =
  /^community-verification\/[a-f0-9]{64}\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/;

export function isSafeR2Key(value: unknown): value is string {
  return typeof value === "string" && SAFE_R2_KEY.test(value);
}

export async function createEvidenceKey(
  userId: string,
  extension: "jpg" | "png" | "webp" | "pdf",
): Promise<string> {
  return `${await evidenceOwnerPrefix(userId)}${crypto.randomUUID()}.${extension}`;
}

export async function getEvidenceBucket(): Promise<R2BucketLike | null> {
  try {
    const workers = await import("cloudflare:workers");
    const candidate = workers.env?.[R2_BINDING_NAME];
    if (!candidate || typeof candidate !== "object") return null;
    const bucket = candidate as Partial<R2BucketLike>;
    return typeof bucket.put === "function" &&
      typeof bucket.get === "function" &&
      typeof bucket.head === "function"
      ? (bucket as R2BucketLike)
      : null;
  } catch {
    // Node-based tests and builds have no Workers binding. Production must
    // return null and fail closed if the configured binding is unavailable.
    return null;
  }
}

export async function storeEvidenceFile(
  bucket: R2BucketLike,
  userId: string,
  file: {
    type: string;
    size: number;
    name: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  },
) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateR2UploadFile({
    contentType: file.type,
    sizeBytes: file.size,
    fileName: file.name,
    bytes,
  });
  if (!validation.ok) return validation;
  if (bytes.byteLength !== validation.sizeBytes) {
    return {
      ok: false,
      status: 400,
      error: "The upload size could not be verified.",
    };
  }

  const key = await createEvidenceKey(userId, validation.extension);
  await bucket.put(key, bytes.buffer, {
    httpMetadata: {
      contentType: validation.contentType,
      contentDisposition: `inline; filename="${validation.fileName.replace(/["\\\r\n]/g, "_")}"`,
    },
    customMetadata: { originalFileName: validation.fileName },
  });
  return {
    ok: true as const,
    key,
    contentType: validation.contentType,
    sizeBytes: validation.sizeBytes,
    fileName: validation.fileName,
  };
}

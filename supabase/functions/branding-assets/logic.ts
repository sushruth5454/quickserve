import {
  BRANDING_PNG_HARD_LIMITS,
  PngValidationError,
  validateAndStripPng,
} from "./png.ts";

const BUCKET = "branding-assets";
const PARENT_FLAGS = ["oorva_brand", "branding_runtime", "branding_editor"] as const;
const PUBLIC_FLAGS = ["oorva_brand", "branding_runtime"] as const;
const PREVIEW_TTL_SECONDS = 240;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PUBLIC_CACHE = "public, max-age=300, s-maxage=300, must-revalidate";

export interface BrandingAssetStatus {
  id: string;
  object_path: string;
  sha256: string;
  mime_type: string;
  byte_length: number | string;
  width: number;
  height: number;
  validated_at: string | null;
  published_once: boolean;
  revoked_at: string | null;
}

export interface AssetRegistration {
  assetId: string;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  actorId: string;
}

export interface BrandingAssetDependencies {
  verifyUser(token: string): Promise<{ id: string } | null>;
  isAdmin(token: string): Promise<boolean>;
  getFeatures(token: string): Promise<Record<string, unknown> | null>;
  getPublicFeatures(): Promise<Record<string, unknown> | null>;
  getAssetStatus(assetId: string): Promise<BrandingAssetStatus | null>;
  uploadPrivate(path: string, bytes: Uint8Array): Promise<boolean>;
  downloadPrivate(path: string): Promise<Uint8Array | null>;
  removePrivate(path: string): Promise<boolean>;
  registerAsset(input: AssetRegistration): Promise<boolean>;
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string | null>;
  projectUrl: string;
  now?: () => number;
}

class RequestFault extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function noStoreHeaders(extra: Record<string, string> = {}): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store, private, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  return headers;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: noStoreHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function publicHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": PUBLIC_CACHE,
    "X-Content-Type-Options": "nosniff",
    "Content-Type": "image/png",
    ...extra,
  });
}

function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function allEnabled(flags: Record<string, unknown> | null, keys: readonly string[]): boolean {
  return flags !== null && keys.every((key) => flags[key] === true);
}

function fixedObjectPath(assetId: string): string {
  return `branding/${assetId}.png`;
}

function isValidStatus(status: BrandingAssetStatus | null, assetId: string, published: boolean): status is BrandingAssetStatus {
  if (!status || typeof status.id !== "string" || status.id.toLowerCase() !== assetId) return false;
  if (typeof status.object_path !== "string" || status.object_path !== fixedObjectPath(assetId)) return false;
  if (typeof status.sha256 !== "string" || status.sha256 !== status.sha256.toLowerCase() || !SHA256_PATTERN.test(status.sha256)) return false;
  if (status.mime_type !== "image/png" || typeof status.validated_at !== "string" || status.revoked_at !== null) return false;
  if (published && status.published_once !== true) return false;
  const byteLength = Number(status.byte_length);
  return Number.isInteger(byteLength) &&
    byteLength > 0 &&
    byteLength <= BRANDING_PNG_HARD_LIMITS.maxBytes &&
    Number.isInteger(status.width) &&
    Number.isInteger(status.height) &&
    status.width >= BRANDING_PNG_HARD_LIMITS.minDimension &&
    status.height >= BRANDING_PNG_HARD_LIMITS.minDimension &&
    status.width <= BRANDING_PNG_HARD_LIMITS.maxDimension &&
    status.height <= BRANDING_PNG_HARD_LIMITS.maxDimension &&
    status.width * status.height <= BRANDING_PNG_HARD_LIMITS.maxPixels;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new RequestFault(400, "invalid content length");
    if (Number(declaredLength) > limit) throw new RequestFault(413, "request body is too large");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new RequestFault(413, "request body is too large");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}

function assetIdFromQuery(url: URL, key: "assetId" | "action"): string | null {
  const values = [...url.searchParams.entries()];
  if (values.length !== 1 || values[0]?.[0] !== key || !values[0]?.[1]) return null;
  return values[0][1];
}

function equalEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || trimmed === etag || trimmed === `W/${etag}`;
  });
}

function validAssetBytes(bytes: Uint8Array, status: BrandingAssetStatus): Promise<boolean> {
  return validateAndStripPng(bytes).then(async (png) =>
    png.width === status.width &&
    png.height === status.height &&
    png.bytes.length === Number(status.byte_length) &&
    await sha256(png.bytes) === status.sha256
  );
}

function parsePreviewBody(bytes: Uint8Array): string {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestFault(400, "invalid preview request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestFault(400, "invalid preview request");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "assetId") || typeof body.assetId !== "string" || !UUID_PATTERN.test(body.assetId)) {
    throw new RequestFault(400, "invalid preview request");
  }
  return body.assetId.toLowerCase();
}

function validatedSignedUrl(rawUrl: string, projectUrl: string, assetId: string): string | null {
  let project: URL;
  let signed: URL;
  try {
    project = new URL(projectUrl);
    signed = new URL(rawUrl, project);
  } catch {
    return null;
  }
  const expectedPath = `/storage/v1/object/sign/${BUCKET}/${fixedObjectPath(assetId)}`;
  if (
    signed.origin !== project.origin ||
    signed.username !== "" ||
    signed.password !== "" ||
    signed.pathname !== expectedPath ||
    signed.searchParams.get("token") === null ||
    [...signed.searchParams.keys()].some((key) => key !== "token")
  ) {
    return null;
  }
  return signed.toString();
}

async function handlePublicGet(request: Request, url: URL, deps: BrandingAssetDependencies): Promise<Response> {
  const assetIdRaw = assetIdFromQuery(url, "assetId");
  if (!assetIdRaw || !UUID_PATTERN.test(assetIdRaw)) return jsonResponse({ error: "asset not found" }, 404);
  const assetId = assetIdRaw.toLowerCase();
  const flags = await deps.getPublicFeatures().catch(() => null);
  if (flags === null) return jsonResponse({ error: "asset service unavailable" }, 503);
  if (!allEnabled(flags, PUBLIC_FLAGS)) return jsonResponse({ error: "asset not found" }, 404);

  let status: BrandingAssetStatus | null;
  try {
    status = await deps.getAssetStatus(assetId);
  } catch {
    return jsonResponse({ error: "asset service unavailable" }, 503);
  }
  if (!isValidStatus(status, assetId, true)) return jsonResponse({ error: "asset not found" }, 404);
  const path = fixedObjectPath(assetId);
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.downloadPrivate(path);
  } catch {
    bytes = null;
  }
  if (!bytes) return jsonResponse({ error: "asset unavailable" }, 502);
  let image: Awaited<ReturnType<typeof validateAndStripPng>>;
  try {
    image = await validateAndStripPng(bytes);
  } catch {
    return jsonResponse({ error: "asset unavailable" }, 502);
  }
  const valid = image.width === status.width &&
    image.height === status.height &&
    image.bytes.length === Number(status.byte_length) &&
    await sha256(image.bytes) === status.sha256;
  if (!valid) return jsonResponse({ error: "asset unavailable" }, 502);

  const etag = `"${status.sha256}"`;
  const headers = publicHeaders({
    "Content-Length": String(image.bytes.length),
    "Content-Disposition": `inline; filename="${assetId}.png"`,
    "ETag": etag,
  });
  if (equalEtag(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(image.bytes, { status: 200, headers });
}

async function authenticateAdminPost(request: Request, deps: BrandingAssetDependencies): Promise<{ userId: string } | Response> {
  const token = parseBearerToken(request);
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  let user: { id: string } | null;
  try {
    user = await deps.verifyUser(token);
  } catch {
    user = null;
  }
  if (!user || !UUID_PATTERN.test(user.id)) return jsonResponse({ error: "unauthorized" }, 401);
  let admin = false;
  try {
    admin = await deps.isAdmin(token);
  } catch {
    return jsonResponse({ error: "authorization unavailable" }, 503);
  }
  if (!admin) return jsonResponse({ error: "admin only" }, 403);
  let flags: Record<string, unknown> | null;
  try {
    flags = await deps.getFeatures(token);
  } catch {
    return jsonResponse({ error: "branding availability could not be checked" }, 503);
  }
  if (flags === null) return jsonResponse({ error: "branding availability could not be checked" }, 503);
  if (!allEnabled(flags, PARENT_FLAGS)) return jsonResponse({ error: "branding editor is disabled" }, 403);
  return { userId: user.id.toLowerCase() };
}

async function handleUpload(request: Request, userId: string, deps: BrandingAssetDependencies): Promise<Response> {
  if (request.headers.get("Content-Type")?.trim().toLowerCase() !== "image/png") {
    return jsonResponse({ error: "image/png is required" }, 415);
  }
  const contentEncoding = request.headers.get("Content-Encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    return jsonResponse({ error: "encoded request bodies are not supported" }, 415);
  }

  let image: Awaited<ReturnType<typeof validateAndStripPng>>;
  try {
    const bytes = await readLimitedBody(request, BRANDING_PNG_HARD_LIMITS.maxBytes);
    image = await validateAndStripPng(bytes);
  } catch (error) {
    if (error instanceof RequestFault) return jsonResponse({ error: error.message }, error.status);
    if (error instanceof PngValidationError) {
      const status = error.message.includes("size limit") ? 413 : 422;
      return jsonResponse({ error: "invalid PNG" }, status);
    }
    return jsonResponse({ error: "invalid PNG" }, 422);
  }

  const assetId = crypto.randomUUID().toLowerCase();
  const path = fixedObjectPath(assetId);
  let uploaded = false;
  try {
    uploaded = await deps.uploadPrivate(path, image.bytes);
  } catch {
    uploaded = false;
  }
  if (!uploaded) return jsonResponse({ error: "asset upload failed" }, 502);

  const metadata: AssetRegistration = {
    assetId,
    sha256: await sha256(image.bytes),
    byteLength: image.bytes.length,
    width: image.width,
    height: image.height,
    actorId: userId,
  };
  let registered = false;
  try {
    registered = await deps.registerAsset(metadata);
  } catch {
    registered = false;
  }
  if (!registered) {
    let cleanupSucceeded = false;
    try {
      cleanupSucceeded = await deps.removePrivate(path);
    } catch {
      cleanupSucceeded = false;
    }
    if (!cleanupSucceeded) console.error("branding asset orphan cleanup failed", assetId);
    return jsonResponse({
      error: "asset registration failed",
      orphanCleanup: cleanupSucceeded ? "complete" : "failed",
    }, 502);
  }
  return jsonResponse({
    assetId,
    sha256: metadata.sha256,
    mimeType: "image/png",
    byteLength: metadata.byteLength,
    width: image.width,
    height: image.height,
  }, 201);
}

async function handlePreview(request: Request, deps: BrandingAssetDependencies): Promise<Response> {
  let assetId: string;
  try {
    assetId = parsePreviewBody(await readLimitedBody(request, 4096));
  } catch (error) {
    if (error instanceof RequestFault) return jsonResponse({ error: error.message }, error.status);
    return jsonResponse({ error: "invalid preview request" }, 400);
  }
  let status: BrandingAssetStatus | null;
  try {
    status = await deps.getAssetStatus(assetId);
  } catch {
    return jsonResponse({ error: "asset service unavailable" }, 503);
  }
  if (!isValidStatus(status, assetId, false)) return jsonResponse({ error: "asset not found" }, 404);

  let bytes: Uint8Array | null;
  try {
    bytes = await deps.downloadPrivate(status.object_path);
  } catch {
    bytes = null;
  }
  if (!bytes) return jsonResponse({ error: "asset unavailable" }, 404);
  try {
    if (!await validAssetBytes(bytes, status)) return jsonResponse({ error: "asset unavailable" }, 404);
  } catch {
    return jsonResponse({ error: "asset unavailable" }, 404);
  }

  const issuedAt = (deps.now ?? Date.now)();
  let rawSignedUrl: string | null;
  try {
    rawSignedUrl = await deps.createSignedUrl(status.object_path, PREVIEW_TTL_SECONDS);
  } catch {
    rawSignedUrl = null;
  }
  if (!rawSignedUrl) return jsonResponse({ error: "preview unavailable" }, 502);
  const signedUrl = validatedSignedUrl(rawSignedUrl, deps.projectUrl, assetId);
  if (!signedUrl) return jsonResponse({ error: "preview unavailable" }, 502);
  if ((deps.now ?? Date.now)() >= issuedAt + PREVIEW_TTL_SECONDS * 1000) {
    return jsonResponse({ error: "preview unavailable" }, 502);
  }
  return jsonResponse({
    assetId,
    url: signedUrl,
    expiresAt: new Date(issuedAt + PREVIEW_TTL_SECONDS * 1000).toISOString(),
  });
}

export async function handleBrandingAssetsRequest(
  request: Request,
  deps: BrandingAssetDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: noStoreHeaders() });
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }
  const url = new URL(request.url);

  try {
    if (request.method === "GET") return await handlePublicGet(request, url, deps);
    const authorization = await authenticateAdminPost(request, deps);
    if (authorization instanceof Response) return authorization;
    const action = assetIdFromQuery(url, "action");
    if (action === "upload") return await handleUpload(request, authorization.userId, deps);
    if (action === "preview") {
      if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        return jsonResponse({ error: "application/json is required" }, 415);
      }
      return await handlePreview(request, deps);
    }
    return jsonResponse({ error: "unsupported action" }, 400);
  } catch {
    return jsonResponse({ error: "asset service unavailable" }, 503);
  }
}

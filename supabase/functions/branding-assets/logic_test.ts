import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { deflateSync } from "node:zlib";
import {
  handleBrandingAssetsRequest,
  type BrandingAssetDependencies,
  type BrandingAssetStatus,
} from "./logic.ts";
import { validateAndStripPng } from "./png.ts";

const FLAGS = { oorva_brand: true, branding_runtime: true, branding_editor: true };
const USER_ID = "e9c2ee34-d1f8-4d40-b8b5-31d02e66b4b1";
const ASSET_ID = "14ae654c-dfe8-4578-9d8e-119f4c787e73";
const PROJECT_URL = "https://project.example.supabase.co";
const SIGNED_URL = `${PROJECT_URL}/storage/v1/object/sign/branding-assets/branding/${ASSET_ID}.png?token=short-storage-signature`;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

function crc32(type: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of type) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function write32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(data.length + 12);
  write32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  write32(chunk, data.length + 8, crc32(typeBytes, data));
  return chunk;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function validPng(): Uint8Array {
  const header = new Uint8Array(13);
  write32(header, 0, 32);
  write32(header, 4, 32);
  header[8] = 8;
  header[9] = 6;
  const raw = new Uint8Array(32 * (1 + 32 * 4));
  const compressed = new Uint8Array(deflateSync(raw));
  return concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function statusFor(assetId: string, bytes: Uint8Array, overrides: Partial<BrandingAssetStatus> = {}): BrandingAssetStatus {
  return {
    id: assetId,
    object_path: `branding/${assetId}.png`,
    sha256: "0".repeat(64),
    mime_type: "image/png",
    byte_length: bytes.length,
    width: 32,
    height: 32,
    validated_at: "2026-01-01T00:00:00Z",
    published_once: true,
    revoked_at: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BrandingAssetDependencies> = {}): BrandingAssetDependencies {
  const bytes = validPng();
  return {
    projectUrl: PROJECT_URL,
    verifyUser: async () => ({ id: USER_ID }),
    isAdmin: async () => true,
    getFeatures: async () => FLAGS,
    getPublicFeatures: async () => ({ oorva_brand: true, branding_runtime: true }),
    getAssetStatus: async (assetId) => statusFor(assetId, bytes, { sha256: await digest(bytes) }),
    uploadPrivate: async () => true,
    downloadPrivate: async () => bytes,
    removePrivate: async () => true,
    registerAsset: async () => true,
    createSignedUrl: async () => SIGNED_URL,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function uploadRequest(
  token = "admin-session-token",
  bytes = validPng(),
  contentType = "image/png",
): Request {
  return new Request(`${PROJECT_URL}/functions/v1/branding-assets?action=upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": contentType,
    },
    body: bytes,
  });
}

function previewRequest(body: unknown, token = "admin-session-token"): Request {
  return new Request(`${PROJECT_URL}/functions/v1/branding-assets?action=preview`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("admin POST verifies user, admin role, and every parent before Storage access", async () => {
  const calls: string[] = [];
  const noToken = await handleBrandingAssetsRequest(
    uploadRequest(""),
    makeDeps({
      verifyUser: async () => {
        calls.push("verifyUser");
        return null;
      },
      uploadPrivate: async () => {
        calls.push("upload");
        return true;
      },
    }),
  );
  assertEquals(noToken.status, 401);
  assertEquals(calls, ["verifyUser"]);

  calls.length = 0;
  const notAdmin = await handleBrandingAssetsRequest(
    uploadRequest(),
    makeDeps({
      verifyUser: async () => {
        calls.push("verifyUser");
        return { id: USER_ID };
      },
      isAdmin: async () => {
        calls.push("isAdmin");
        return false;
      },
      uploadPrivate: async () => {
        calls.push("upload");
        return true;
      },
    }),
  );
  assertEquals(notAdmin.status, 403);
  assertEquals(calls, ["verifyUser", "isAdmin"]);

  for (const flag of ["oorva_brand", "branding_runtime", "branding_editor"]) {
    calls.length = 0;
    const disabled = await handleBrandingAssetsRequest(
      uploadRequest(),
      makeDeps({
        verifyUser: async () => {
          calls.push("verifyUser");
          return { id: USER_ID };
        },
        isAdmin: async () => {
          calls.push("isAdmin");
          return true;
        },
        getFeatures: async () => {
          calls.push("getFeatures");
          return { ...FLAGS, [flag]: false };
        },
        uploadPrivate: async () => {
          calls.push("upload");
          return true;
        },
      }),
    );
    assertEquals(disabled.status, 403, `disabled=${flag}; actual=${JSON.stringify({ status: disabled.status, calls })}`);
    assertEquals(calls, ["verifyUser", "isAdmin", "getFeatures"], `disabled=${flag}; actual=${JSON.stringify(calls)}`);
  }

  const unavailable = await handleBrandingAssetsRequest(
    uploadRequest(),
    makeDeps({
      getFeatures: async () => null,
      uploadPrivate: async () => {
        calls.push("upload");
        return true;
      },
    }),
  );
  assertEquals(unavailable.status, 503);
  assertEquals(calls.includes("upload"), false);
});

Deno.test("upload validates MIME and PNG before immutable Storage, then registers fixed metadata", async () => {
  const badMime = await handleBrandingAssetsRequest(
    uploadRequest("admin-session-token", validPng(), "image/svg+xml"),
    makeDeps(),
  );
  assertEquals(badMime.status, 415);

  const invalidPng = await handleBrandingAssetsRequest(
    uploadRequest("admin-session-token", new TextEncoder().encode("<svg/>"), "image/png"),
    makeDeps(),
  );
  assertEquals(invalidPng.status, 422);

  const calls: Array<{ name: string; path?: string; metadata?: unknown }> = [];
  const deps = makeDeps({
    uploadPrivate: async (path, image) => {
      calls.push({ name: "upload", path });
      assertEquals((await validateAndStripPng(image)).width, 32);
      return true;
    },
    registerAsset: async (metadata) => {
      calls.push({ name: "register", metadata });
      return true;
    },
  });
  const response = await handleBrandingAssetsRequest(uploadRequest(), deps);
  const body = await response.json();
  assertEquals(response.status, 201);
  assertMatch(body.assetId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assertEquals(body.mimeType, "image/png");
  assertEquals(calls.map((call) => call.name), ["upload", "register"]);
  assertEquals(calls[0].path, `branding/${body.assetId}.png`);
  assertEquals((calls[1].metadata as { actorId: string }).actorId, USER_ID);
  assertEquals((calls[1].metadata as { sha256: string }).sha256, body.sha256);
  assertEquals(response.headers.get("Cache-Control"), "no-store, private, max-age=0");
  assertEquals(response.headers.get("Referrer-Policy"), "no-referrer");
});

Deno.test("registration failure removes only this request's known immutable object", async () => {
  const removed: string[] = [];
  const response = await handleBrandingAssetsRequest(
    uploadRequest(),
    makeDeps({
      registerAsset: async () => false,
      removePrivate: async (path) => {
        removed.push(path);
        return true;
      },
    }),
  );
  assertEquals(response.status, 502);
  assertEquals(removed.length, 1);
  assertMatch(removed[0], /^branding\/[0-9a-f-]{36}\.png$/);

  const failedUploadRemoved: string[] = [];
  const failedUpload = await handleBrandingAssetsRequest(
    uploadRequest(),
    makeDeps({
      uploadPrivate: async () => false,
      removePrivate: async (path) => {
        failedUploadRemoved.push(path);
        return true;
      },
    }),
  );
  assertEquals(failedUpload.status, 502);
  assertEquals(failedUploadRemoved, []);

  const cleanupFailure = await handleBrandingAssetsRequest(
    uploadRequest(),
    makeDeps({
      registerAsset: async () => false,
      removePrivate: async () => false,
    }),
  );
  assertEquals(cleanupFailure.status, 502);
  assertEquals((await cleanupFailure.json()).orphanCleanup, "failed");
});

Deno.test("public GET checks independent flags and published, validated, non-revoked metadata before Storage", async () => {
  const bytes = validPng();
  const sha = await digest(bytes);
  const calls: string[] = [];
  const response = await handleBrandingAssetsRequest(
    new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=${ASSET_ID}`),
    makeDeps({
      getPublicFeatures: async () => {
        calls.push("flags");
        return { oorva_brand: true, branding_runtime: true };
      },
      getAssetStatus: async (id) => {
        calls.push("status");
        return statusFor(id, bytes, { sha256: sha });
      },
      downloadPrivate: async (path) => {
        calls.push(`storage:${path}`);
        return bytes;
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(calls, ["flags", "status", `storage:branding/${ASSET_ID}.png`]);
  assertEquals(response.headers.get("Cache-Control"), "public, max-age=300, s-maxage=300, must-revalidate");
  assertEquals(response.headers.get("ETag"), `"${sha}"`);
  assertEquals(response.headers.get("Content-Type"), "image/png");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");

  const ifNoneMatch = await handleBrandingAssetsRequest(
    new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=${ASSET_ID}`, {
      headers: { "If-None-Match": `"${sha}"` },
    }),
    makeDeps({ getAssetStatus: async (id) => statusFor(id, bytes, { sha256: sha }) }),
  );
  assertEquals(ifNoneMatch.status, 304);
  assertEquals(ifNoneMatch.headers.get("ETag"), `"${sha}"`);
});

Deno.test("public GET refuses unpublished/revoked IDs and keeps all assets inaccessible when parent flags are OFF", async () => {
  const bytes = validPng();
  for (const status of [
    statusFor(ASSET_ID, bytes, { published_once: false }),
    statusFor(ASSET_ID, bytes, { revoked_at: "2026-01-02T00:00:00Z" }),
    statusFor(ASSET_ID, bytes, { validated_at: null }),
    null,
  ]) {
    let storageReads = 0;
    const response = await handleBrandingAssetsRequest(
      new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=${ASSET_ID}`),
      makeDeps({
        getAssetStatus: async () => status,
        downloadPrivate: async () => {
          storageReads++;
          return bytes;
        },
      }),
    );
    assertEquals(response.status, 404);
    assertEquals(storageReads, 0);
  }

  for (const disabled of [{ oorva_brand: false, branding_runtime: true }, { oorva_brand: true, branding_runtime: false }]) {
    let statusReads = 0;
    let storageReads = 0;
    const response = await handleBrandingAssetsRequest(
      new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=${ASSET_ID}`),
      makeDeps({
        getPublicFeatures: async () => disabled,
        getAssetStatus: async () => {
          statusReads++;
          return statusFor(ASSET_ID, bytes);
        },
        downloadPrivate: async () => {
          storageReads++;
          return bytes;
        },
      }),
    );
    assertEquals(response.status, 404);
    assertEquals([statusReads, storageReads], [0, 0]);
  }
});

Deno.test("admin preview is private, origin-pinned, signed, and expires within five minutes", async () => {
  const bytes = validPng();
  const response = await handleBrandingAssetsRequest(
    previewRequest({ assetId: ASSET_ID }),
    makeDeps({
      getAssetStatus: async (id) => statusFor(id, bytes, { sha256: await digest(bytes), published_once: false }),
      createSignedUrl: async (_path, ttl) => {
        assertEquals(ttl, 240);
        return SIGNED_URL;
      },
    }),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store, private, max-age=0");
  assertEquals(response.headers.get("Pragma"), "no-cache");
  assertEquals(response.headers.get("Referrer-Policy"), "no-referrer");
  assertEquals(new URL(body.url).origin, PROJECT_URL);
  assertEquals(body.assetId, ASSET_ID);
  const lifetime = Date.parse(body.expiresAt) - Date.parse("2026-01-01T00:00:00.000Z");
  assert(lifetime > 0 && lifetime <= 300_000);
  assertEquals(body.url.includes("admin-session-token"), false);
});

Deno.test("preview rejects revoked/unvalidated assets and arbitrary remote URL fields without signing", async () => {
  const bytes = validPng();
  let reads = 0;
  let signs = 0;
  const revoked = await handleBrandingAssetsRequest(
    previewRequest({ assetId: ASSET_ID }),
    makeDeps({
      getAssetStatus: async (id) => statusFor(id, bytes, {
        sha256: await digest(bytes),
        revoked_at: "2026-01-02T00:00:00Z",
      }),
      downloadPrivate: async () => {
        reads++;
        return bytes;
      },
      createSignedUrl: async () => {
        signs++;
        return SIGNED_URL;
      },
    }),
  );
  assertEquals(revoked.status, 404);
  assertEquals([reads, signs], [0, 0]);

  const arbitraryUrl = await handleBrandingAssetsRequest(
    previewRequest({ assetId: ASSET_ID, url: "https://attacker.example/image.png" }),
    makeDeps({
      downloadPrivate: async () => {
        reads++;
        return bytes;
      },
    }),
  );
  assertEquals(arbitraryUrl.status, 400);
  assertEquals(reads, 0);

  const badOrigin = await handleBrandingAssetsRequest(
    previewRequest({ assetId: ASSET_ID }),
    makeDeps({
      getAssetStatus: async (id) => statusFor(id, bytes, { sha256: await digest(bytes) }),
      createSignedUrl: async () => "https://attacker.example/sign?token=leak",
    }),
  );
  assertEquals(badOrigin.status, 502);
});

Deno.test("GET accepts only a UUID query; paths, methods, and caller-supplied storage locations are rejected", async () => {
  const badId = await handleBrandingAssetsRequest(
    new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=../secret`),
    makeDeps(),
  );
  assertEquals(badId.status, 404);

  const pathRequest = await handleBrandingAssetsRequest(
    new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=${ASSET_ID}&path=other.png`),
    makeDeps(),
  );
  assertEquals(pathRequest.status, 404);

  const head = await handleBrandingAssetsRequest(
    new Request(`${PROJECT_URL}/functions/v1/branding-assets?assetId=${ASSET_ID}`, { method: "HEAD" }),
    makeDeps(),
  );
  assertEquals(head.status, 405);

  const preflight = await handleBrandingAssetsRequest(
    new Request(`${PROJECT_URL}/functions/v1/branding-assets`, { method: "OPTIONS" }),
    makeDeps(),
  );
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("Cache-Control"), "no-store, private, max-age=0");
});

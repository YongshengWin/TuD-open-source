import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AVATAR_BYTES,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_REQUEST_BYTES,
  normalizeProfileName,
  parseProfilePatch,
  ProfileInputError,
  readLimitedJson,
  validateAvatarDataUrl,
} from "../lib/profile-values.ts";

function png(width, height, extraChunks = []) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, "ascii");
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    ...extraChunks.map(([type, data]) => chunk(type, data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpeg(width, height) {
  const sof = Buffer.alloc(17);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  sof.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 6);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x13]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webp(width, height, flags = 0) {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const bytes = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8X"),
    Buffer.from([10, 0, 0, 0]),
    payload,
  ]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

function dataUrl(mimeType, bytes) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function profileError(message) {
  return (error) => error instanceof ProfileInputError && (!message || error.message.includes(message));
}

test("normalizes a nickname while preserving multilingual text", () => {
  assert.equal(normalizeProfileName("  小明   Alex  "), "小明 Alex");
  assert.equal(normalizeProfileName("TuD 🚀"), "TuD 🚀");
  assert.throws(() => normalizeProfileName("   "), profileError("请输入昵称"));
  assert.throws(() => normalizeProfileName(`name\nother`), profileError("不支持"));
  assert.throws(() => normalizeProfileName("名".repeat(MAX_PROFILE_NAME_LENGTH + 1)), profileError("不能超过"));
});

test("accepts only validated PNG, JPEG, and WebP avatar data URLs", () => {
  for (const [mimeType, bytes] of [
    ["image/png", png(256, 128)],
    ["image/jpeg", jpeg(320, 240)],
    ["image/webp", webp(512, 512)],
  ]) {
    const result = validateAvatarDataUrl(dataUrl(mimeType, bytes));
    assert.equal(result.mimeType, mimeType);
    assert.ok(result.bytes.equals(bytes));
    assert.ok(result.width > 0);
    assert.ok(result.height > 0);
  }
  assert.throws(
    () => validateAvatarDataUrl(dataUrl("image/png", jpeg(128, 128))),
    profileError("格式不匹配"),
  );
  assert.throws(
    () => validateAvatarDataUrl("data:image/svg+xml;base64,PHN2Zy8+"),
    profileError("仅支持"),
  );
});

test("rejects oversized, over-dimensioned, animated, and malformed avatars", () => {
  assert.throws(
    () => validateAvatarDataUrl(dataUrl("image/png", Buffer.alloc(MAX_AVATAR_BYTES + 1))),
    profileError("512 KB"),
  );
  assert.throws(
    () => validateAvatarDataUrl(dataUrl("image/png", png(1025, 1))),
    profileError("尺寸"),
  );
  assert.throws(
    () => validateAvatarDataUrl(dataUrl("image/png", png(64, 64, [["acTL", Buffer.alloc(8)]]))),
    profileError("动画"),
  );
  assert.throws(
    () => validateAvatarDataUrl(dataUrl("image/webp", webp(64, 64, 0x02))),
    profileError("动画"),
  );
  assert.throws(() => validateAvatarDataUrl("data:image/png;base64,***"), profileError("仅支持"));
});

test("profile patches expose only name and image", () => {
  const selected = parseProfilePatch({ name: "  TuD  ", image: dataUrl("image/png", png(80, 80)) });
  assert.equal(selected.name, "TuD");
  assert.equal(selected.avatar?.width, 80);
  assert.deepEqual(parseProfilePatch({ image: null }), { avatar: null });
  assert.throws(() => parseProfilePatch({}), profileError("不支持的字段"));
  assert.throws(() => parseProfilePatch({ email: "new@example.com" }), profileError("不支持的字段"));
});

test("request JSON parsing enforces the endpoint body limit", async () => {
  const request = new Request("http://localhost/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ name: "TuD" }),
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await readLimitedJson(request), { name: "TuD" });

  const oversized = new Request("http://localhost/api/profile", {
    method: "PATCH",
    body: "x",
    headers: { "content-length": String(MAX_PROFILE_REQUEST_BYTES + 1) },
  });
  await assert.rejects(readLimitedJson(oversized), profileError("过大"));
});

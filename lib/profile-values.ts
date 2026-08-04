export const MAX_PROFILE_NAME_LENGTH = 48;
export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_AVATAR_EDGE = 1024;
export const MAX_AVATAR_PIXELS = 1024 * 1024;
export const MAX_PROFILE_REQUEST_BYTES = Math.ceil(MAX_AVATAR_BYTES * 4 / 3) + 8 * 1024;

export type AvatarMimeType = "image/png" | "image/jpeg" | "image/webp";

export type ValidatedAvatar = {
  bytes: Buffer;
  mimeType: AvatarMimeType;
  width: number;
  height: number;
};

export type ValidatedProfilePatch = {
  name?: string;
  avatar?: ValidatedAvatar | null;
};

export class ProfileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileInputError";
  }
}

function invalid(message: string): never {
  throw new ProfileInputError(message);
}

export function normalizeProfileName(value: unknown): string {
  if (typeof value !== "string") invalid("昵称格式不正确");
  const unicodeValue = value.normalize("NFC");
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(unicodeValue)) invalid("昵称包含不支持的字符");
  const normalized = unicodeValue.replace(/\s+/gu, " ").trim();
  if (!normalized || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(normalized)) invalid("请输入昵称");
  if (Array.from(normalized).length > MAX_PROFILE_NAME_LENGTH) {
    invalid(`昵称不能超过 ${MAX_PROFILE_NAME_LENGTH} 个字符`);
  }
  return normalized;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return null;

  let offset = 8;
  let dimensions: { width: number; height: number } | null = null;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > bytes.length) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12) };
    }
    if (type === "acTL") invalid("头像不能使用动画图片");
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.length) return null;
      ended = true;
      break;
    }
    offset = next;
  }
  return ended ? dimensions : null;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      if (length < 7) return null;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function readUInt24LE(bytes: Buffer, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;

  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const next = dataOffset + length + (length % 2);
    if (next > bytes.length) return null;
    if (type === "ANIM" || type === "ANMF") invalid("头像不能使用动画图片");

    if (!dimensions && type === "VP8X" && length >= 10) {
      if ((bytes[dataOffset] & 0x02) !== 0) invalid("头像不能使用动画图片");
      dimensions = {
        width: readUInt24LE(bytes, dataOffset + 4) + 1,
        height: readUInt24LE(bytes, dataOffset + 7) + 1,
      };
    } else if (!dimensions && type === "VP8 " && length >= 10) {
      if (!bytes.subarray(dataOffset + 3, dataOffset + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return null;
      dimensions = {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    } else if (!dimensions && type === "VP8L" && length >= 5) {
      if (bytes[dataOffset] !== 0x2f) return null;
      dimensions = {
        width: 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8),
        height: 1 + (bytes[dataOffset + 2] >> 6) + (bytes[dataOffset + 3] << 2) + ((bytes[dataOffset + 4] & 0x0f) << 10),
      };
    }
    offset = next;
  }
  return offset === bytes.length ? dimensions : null;
}

function dimensionsForMime(bytes: Buffer, mimeType: AvatarMimeType) {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

export function validateAvatarDataUrl(value: unknown): ValidatedAvatar {
  if (typeof value !== "string") invalid("头像格式不正确");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) invalid("头像仅支持 PNG、JPEG 或 WebP");
  const mimeType = match[1] as AvatarMimeType;
  const encoded = match[2];
  if (encoded.length % 4 !== 0) invalid("头像数据损坏");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded) invalid("头像数据损坏");
  if (bytes.length > MAX_AVATAR_BYTES) invalid("头像不能超过 512 KB");

  const dimensions = dimensionsForMime(bytes, mimeType);
  if (!dimensions) invalid("头像文件损坏或格式不匹配");
  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width > MAX_AVATAR_EDGE || height > MAX_AVATAR_EDGE || width * height > MAX_AVATAR_PIXELS) {
    invalid(`头像尺寸不能超过 ${MAX_AVATAR_EDGE}×${MAX_AVATAR_EDGE}`);
  }
  return { bytes, mimeType, width, height };
}

export function parseProfilePatch(value: unknown): ValidatedProfilePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("请求格式不正确");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "image")) invalid("请求包含不支持的字段");

  const result: ValidatedProfilePatch = {};
  if (Object.hasOwn(record, "name")) result.name = normalizeProfileName(record.name);
  if (Object.hasOwn(record, "image")) {
    result.avatar = record.image === null ? null : validateAvatarDataUrl(record.image);
  }
  return result;
}

export async function readLimitedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_PROFILE_REQUEST_BYTES) invalid("请求内容过大");
  if (!request.body) invalid("请求内容为空");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_PROFILE_REQUEST_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The request is rejected regardless of whether its producer accepts cancellation.
      }
      invalid("请求内容过大");
    }
    chunks.push(value);
  }

  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid("请求格式不正确");
  }
}

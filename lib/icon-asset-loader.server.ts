export const ICON_ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const ICON_ASSET_DEFAULT_TIMEOUT_MS = 5_000;

export type IconAssetProvider =
  | "local"
  | "hd-icons"
  | "dashboard-icons"
  | "lobe-icons"
  | "selfhst-icons"
  | "simple-icons";

export type IconAssetCatalogDescriptor = {
  provider: IconAssetProvider | string;
  assetUrl: string;
  mimeType: string;
  accent?: string | null;
};

export type LoadedIconAssetMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/x-icon" | "image/svg+xml";

export type LoadedIconAsset = {
  bytes: Buffer;
  mimeType: LoadedIconAssetMimeType;
};

export type UntrustedSvgIconOptions = {
  allowEmbeddedPngImages?: boolean;
};

export type IconAssetFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type IconAssetLoaderOptions = {
  fetcher?: IconAssetFetch;
  timeoutMs?: number;
  maxBytes?: number;
};

export type IconAssetLoaderErrorCode =
  | "INVALID_DESCRIPTOR"
  | "UNSAFE_PATH"
  | "UNSAFE_REMOTE"
  | "READ_FAILED"
  | "FETCH_FAILED"
  | "TIMEOUT"
  | "REDIRECT"
  | "HTTP_ERROR"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "MIME_MISMATCH"
  | "UNSAFE_SVG";

export class IconAssetLoaderError extends Error {
  readonly code: IconAssetLoaderErrorCode;

  constructor(code: IconAssetLoaderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IconAssetLoaderError";
    this.code = code;
  }
}

type ResolvedLoaderOptions = {
  fetcher: IconAssetFetch;
  timeoutMs: number;
  maxBytes: number;
};

type RemoteRule = {
  owner: string;
  repository: string;
  pathPattern: RegExp;
};

const PROVIDERS = new Set<IconAssetProvider>([
  "local",
  "hd-icons",
  "dashboard-icons",
  "lobe-icons",
  "selfhst-icons",
  "simple-icons",
]);

const REMOTE_RULES: Partial<Record<IconAssetProvider, RemoteRule>> = {
  "hd-icons": {
    owner: "xushier",
    repository: "HD-Icons",
    pathPattern: /^border-radius\/[^/]+\.png$/i,
  },
  "dashboard-icons": {
    owner: "homarr-labs",
    repository: "dashboard-icons",
    pathPattern: /^(?:svg\/[^/]+\.svg|webp\/[^/]+\.webp|png\/[^/]+\.png)$/i,
  },
  "lobe-icons": {
    owner: "lobehub",
    repository: "lobe-icons",
    pathPattern: /^packages\/(?:static-svg\/(?:[^/]+\/)*[^/]+\.svg|static-webp\/(?:[^/]+\/)*[^/]+\.webp|static-png\/(?:[^/]+\/)*[^/]+\.png)$/i,
  },
  "selfhst-icons": {
    owner: "selfhst",
    repository: "icons",
    pathPattern: /^(?:svg\/(?:[^/]+\/)*[^/]+\.svg|webp\/(?:[^/]+\/)*[^/]+\.webp|png\/(?:[^/]+\/)*[^/]+\.png)$/i,
  },
};

const MIME_ALIASES: Readonly<Record<string, LoadedIconAssetMimeType>> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/x-icon": "image/x-icon",
  "image/vnd.microsoft.icon": "image/x-icon",
  "image/svg+xml": "image/svg+xml",
};

const EXTENSION_MIME: Readonly<Record<string, LoadedIconAssetMimeType>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function detectRasterMimeType(bytes: Uint8Array): Exclude<LoadedIconAssetMimeType, "image/svg+xml"> | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (
    bytes.length >= 6
    && bytes[0] === 0
    && bytes[1] === 0
    && bytes[2] === 1
    && bytes[3] === 0
    && ((bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8)) > 0
  ) return "image/x-icon";
  return null;
}

function normalizeDescriptorMimeType(value: string) {
  const normalized = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const mimeType = MIME_ALIASES[normalized];
  if (!mimeType) throw new IconAssetLoaderError("UNSUPPORTED_TYPE", "图标格式不受支持");
  return mimeType;
}

function validateProvider(value: string): IconAssetProvider {
  if (!PROVIDERS.has(value as IconAssetProvider)) {
    throw new IconAssetLoaderError("INVALID_DESCRIPTOR", "未知的图标来源");
  }
  return value as IconAssetProvider;
}

function decodePathname(value: string, errorCode: "UNSAFE_PATH" | "UNSAFE_REMOTE") {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch (cause) {
    throw new IconAssetLoaderError(errorCode, "图标路径编码无效", { cause });
  }
  if (
    decoded.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(decoded)
    || decoded.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new IconAssetLoaderError(errorCode, "图标路径不安全");
  }
  return decoded;
}

function assertExtensionMatches(filePath: string, mimeType: LoadedIconAssetMimeType) {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
  const expected = EXTENSION_MIME[extension];
  if (!expected) throw new IconAssetLoaderError("UNSUPPORTED_TYPE", "图标文件扩展名不受支持");
  if (expected !== mimeType) throw new IconAssetLoaderError("MIME_MISMATCH", "图标声明格式与扩展名不一致");
}

function assertSafeRemoteUrl(provider: IconAssetProvider, assetUrl: string, mimeType: LoadedIconAssetMimeType) {
  const rule = REMOTE_RULES[provider];
  if (!rule) throw new IconAssetLoaderError("UNSAFE_REMOTE", "该图标来源不允许远程加载");

  let url: URL;
  try {
    url = new URL(assetUrl);
  } catch (cause) {
    throw new IconAssetLoaderError("UNSAFE_REMOTE", "远程图标地址无效", { cause });
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "raw.githubusercontent.com"
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new IconAssetLoaderError("UNSAFE_REMOTE", "远程图标必须来自固定提交的 GitHub Raw 地址");
  }

  const pathname = decodePathname(url.pathname, "UNSAFE_REMOTE");
  const segments = pathname.split("/");
  if (segments[0] !== "" || segments.length < 5) {
    throw new IconAssetLoaderError("UNSAFE_REMOTE", "远程图标路径无效");
  }
  const owner = segments[1] ?? "";
  const repository = segments[2] ?? "";
  const commit = segments[3] ?? "";
  const assetPath = segments.slice(4).join("/");
  if (
    owner !== rule.owner
    || repository !== rule.repository
    || !/^[0-9a-f]{40}$/.test(commit)
    || !assetPath
    || !rule.pathPattern.test(assetPath)
  ) {
    throw new IconAssetLoaderError("UNSAFE_REMOTE", "远程图标仓库、提交或目录不在允许列表中");
  }

  assertExtensionMatches(assetPath, mimeType);
  return url;
}

function resolveOptions(options: IconAssetLoaderOptions): ResolvedLoaderOptions {
  const timeoutMs = options.timeoutMs ?? ICON_ASSET_DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? ICON_ASSET_MAX_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new IconAssetLoaderError("INVALID_DESCRIPTOR", "图标加载超时配置无效");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > ICON_ASSET_MAX_BYTES) {
    throw new IconAssetLoaderError("INVALID_DESCRIPTOR", "图标大小限制配置无效");
  }
  return {
    fetcher: options.fetcher ?? fetch,
    timeoutMs,
    maxBytes,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new IconAssetLoaderError("TIMEOUT", "图标加载超时"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readResponseBytes(response: Response, maxBytes: number) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new IconAssetLoaderError("TOO_LARGE", "远程图标超过 2 MiB 限制");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the deterministic size error even if the remote stream cannot be cancelled cleanly.
        }
        throw new IconAssetLoaderError("TOO_LARGE", "远程图标超过 2 MiB 限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function fetchRemoteAsset(url: URL, options: ResolvedLoaderOptions) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await withTimeout(options.fetcher(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "image/*",
        "accept-encoding": "identity",
        "user-agent": "TuD-Icon-Asset-Loader/1.0",
      },
    }), options.timeoutMs, () => controller.abort());
  } catch (cause) {
    if (cause instanceof IconAssetLoaderError) throw cause;
    throw new IconAssetLoaderError("FETCH_FAILED", "远程图标获取失败", { cause });
  }

  if (response.status >= 300 && response.status < 400) {
    throw new IconAssetLoaderError("REDIRECT", "远程图标不允许重定向");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new IconAssetLoaderError("HTTP_ERROR", `远程图标返回了 HTTP ${response.status}`);
  }
  const remainingMs = options.timeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    controller.abort();
    throw new IconAssetLoaderError("TIMEOUT", "图标加载超时");
  }
  return withTimeout(readResponseBytes(response, options.maxBytes), remainingMs, () => controller.abort());
}

function decodeSvg(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 不是有效的 UTF-8 文本", { cause });
  }
}

function decodeXmlEntitiesForScan(value: string) {
  return value
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number(code);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    });
}

function replaceValidatedEmbeddedPngImagesForScan(svg: string) {
  const imagePattern = /<image\b[^>]*>/gi;
  let cursor = 0;
  let result = "";
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(svg)) !== null) {
    const tag = match[0];
    if (!/\/\s*>$/.test(tag)) {
      throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 内嵌位图必须使用自闭合元素");
    }
    const hrefPattern = /\s(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    const hrefs = [...tag.matchAll(hrefPattern)];
    if (hrefs.length !== 1) {
      throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 内嵌位图地址无效");
    }
    const href = hrefs[0];
    const value = href?.[1] ?? href?.[2] ?? href?.[3] ?? "";
    const data = value.match(/^data:image\/png;base64,([a-z0-9+/]+={0,2})$/i)?.[1];
    if (!data) {
      throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 只允许内嵌 Base64 PNG 位图");
    }
    const decoded = Buffer.from(data, "base64");
    if (decoded.length === 0 || decoded.length > ICON_ASSET_MAX_BYTES || detectRasterMimeType(decoded) !== "image/png") {
      throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 内嵌 PNG 内容无效");
    }

    const safeTag = tag.replace(href[0], ' xlink:href="#nexdue-embedded-png"');
    result += svg.slice(cursor, match.index) + safeTag;
    cursor = match.index + tag.length;
  }
  return result + svg.slice(cursor);
}

function assertTrustedSvg(svg: string, options: UntrustedSvgIconOptions = {}) {
  const normalized = svg.replace(/^\uFEFF/, "");
  const open = normalized.match(/<svg\b[^>]*>/i);
  if (!open || open.index == null) throw new IconAssetLoaderError("UNSAFE_SVG", "文件不是有效的 SVG");
  const prefix = normalized
    .slice(0, open.index)
    .replace(/<\?xml\b[\s\S]*?\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (prefix) throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 根元素无效");
  if (!/<\/svg\s*>\s*$/i.test(normalized) && !/\/\>\s*$/.test(open[0])) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 根元素没有正确闭合");
  }

  const scan = decodeXmlEntitiesForScan(normalized);
  if (/<!doctype\b|<!entity\b/i.test(scan) || /<\?(?!xml\b)/i.test(scan)) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 包含不安全的 XML 声明");
  }
  if (/<\s*(?:script|foreignobject|iframe|object|embed|feimage|audio|video|canvas|link|meta|base|animate|animatetransform|animatemotion|set)\b/i.test(scan)) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 包含不允许的元素");
  }
  if (!options.allowEmbeddedPngImages && /<\s*image\b/i.test(scan)) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 包含不允许的元素");
  }
  if (/\s(?:on[a-z][\w:.-]*|xml:base|schemaLocation)\s*=/i.test(scan)) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 包含不允许的属性");
  }
  if (/javascript\s*:|vbscript\s*:|@import\b|expression\s*\(|-moz-binding\b|behavior\s*:/i.test(scan)) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 包含可执行或外部内容");
  }

  const urlScan = options.allowEmbeddedPngImages ? replaceValidatedEmbeddedPngImagesForScan(scan) : scan;
  const urlAttributePattern = /\s(?:href|xlink:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = urlAttributePattern.exec(urlScan)) !== null) {
    const value = (attributeMatch[1] ?? attributeMatch[2] ?? attributeMatch[3] ?? "").trim();
    if (!/^#[A-Za-z_][\w:.-]*$/.test(value)) {
      throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 引用了外部资源");
    }
  }

  const cssUrlPattern = /url\(\s*([^)]+?)\s*\)/gi;
  let cssMatch: RegExpExecArray | null;
  while ((cssMatch = cssUrlPattern.exec(scan)) !== null) {
    const value = (cssMatch[1] ?? "").trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    if (!/^#[A-Za-z_][\w:.-]*$/.test(value)) {
      throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 样式引用了外部资源");
    }
  }
  if (/\sstyle\s*=\s*(?:"[^"]*\\[^\"]*"|'[^']*\\[^']*')/i.test(scan)) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 样式包含不安全的转义");
  }
  const styleBlocks = scan.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? [];
  if (styleBlocks.some((block) => block.includes("\\") || /@font-face\b/i.test(block))) {
    throw new IconAssetLoaderError("UNSAFE_SVG", "SVG 样式包含不安全的规则");
  }
}

/**
 * Validate an SVG obtained from an untrusted upstream before it is persisted
 * in the canonical icon asset cache. The returned bytes are normalized UTF-8;
 * Executable, animated and external-resource content is rejected. Embedded
 * PNG data may be enabled only by a curated server-side domain mapping.
 */
export function validateUntrustedSvgIcon(
  bytes: Uint8Array,
  options: UntrustedSvgIconOptions = {},
): LoadedIconAsset {
  const rawBytes = Buffer.from(bytes);
  if (rawBytes.length === 0 || rawBytes.length > ICON_ASSET_MAX_BYTES) {
    throw new IconAssetLoaderError("TOO_LARGE", "SVG 图标为空或超过 2 MiB 限制");
  }
  const svg = decodeSvg(rawBytes);
  assertTrustedSvg(svg, options);
  const normalized = Buffer.from(svg, "utf8");
  if (normalized.length > ICON_ASSET_MAX_BYTES) {
    throw new IconAssetLoaderError("TOO_LARGE", "处理后的 SVG 图标超过 2 MiB 限制");
  }
  return { bytes: normalized, mimeType: "image/svg+xml" };
}

function validateAndTransform(
  rawBytes: Buffer,
  declaredMimeType: LoadedIconAssetMimeType,
): LoadedIconAsset {
  const rasterMimeType = detectRasterMimeType(rawBytes);
  if (rasterMimeType) {
    if (rasterMimeType !== declaredMimeType) {
      throw new IconAssetLoaderError("MIME_MISMATCH", "图标内容与声明格式不一致");
    }
    return { bytes: rawBytes, mimeType: rasterMimeType };
  }
  if (declaredMimeType !== "image/svg+xml") {
    throw new IconAssetLoaderError("MIME_MISMATCH", "图标内容与声明格式不一致");
  }

  const svg = validateUntrustedSvgIcon(rawBytes).bytes.toString("utf8");
  return { bytes: Buffer.from(svg, "utf8"), mimeType: "image/svg+xml" };
}

export async function loadIconAsset(
  descriptor: IconAssetCatalogDescriptor,
  options: IconAssetLoaderOptions = {},
): Promise<LoadedIconAsset> {
  if (!descriptor || typeof descriptor !== "object" || typeof descriptor.assetUrl !== "string" || typeof descriptor.mimeType !== "string") {
    throw new IconAssetLoaderError("INVALID_DESCRIPTOR", "图标目录项无效");
  }
  const provider = validateProvider(descriptor.provider);
  const declaredMimeType = normalizeDescriptorMimeType(descriptor.mimeType);
  const resolvedOptions = resolveOptions(options);
  // Local and Simple Icons assets are served directly from /public. This
  // loader is intentionally remote-only so production output tracing never
  // needs a dynamic filesystem read.
  if (!/^https:\/\//i.test(descriptor.assetUrl)) {
    throw new IconAssetLoaderError("UNSAFE_REMOTE", "服务端资源加载器只接受固定版本的远程图标");
  }
  const remoteUrl = assertSafeRemoteUrl(provider, descriptor.assetUrl, declaredMimeType);
  const bytes = await fetchRemoteAsset(remoteUrl, resolvedOptions);

  if (bytes.length > resolvedOptions.maxBytes) {
    throw new IconAssetLoaderError("TOO_LARGE", "图标超过 2 MiB 限制");
  }
  const loaded = validateAndTransform(bytes, declaredMimeType);
  if (loaded.bytes.length > resolvedOptions.maxBytes) {
    throw new IconAssetLoaderError("TOO_LARGE", "处理后的图标超过 2 MiB 限制");
  }
  return loaded;
}

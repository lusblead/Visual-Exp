const OWNER_COOKIE = "vexp_owner";
const OWNER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface DeviceOwner {
  id: string;
  created: boolean;
}

export function resolveDeviceOwner(cookieHeader: string | null): DeviceOwner {
  const ownerId = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OWNER_COOKIE}=`))
    ?.slice(OWNER_COOKIE.length + 1);
  if (ownerId && OWNER_ID_PATTERN.test(ownerId)) {
    return { id: ownerId.toLowerCase(), created: false };
  }
  return { id: crypto.randomUUID(), created: true };
}

export function deviceOwnerCookie(ownerId: string, secure: boolean): string {
  if (!OWNER_ID_PATTERN.test(ownerId)) {
    throw new Error("ownerId 格式无效");
  }
  return [
    `${OWNER_COOKIE}=${ownerId.toLowerCase()}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

type OriginEnvironment = {
  LDRAW_ALLOWED_ORIGINS?: string;
  REPLIT_DEV_DOMAIN?: string;
  REPLIT_DOMAINS?: string;
};

function parseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function originForDomain(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const domain = value.trim();
  return parseOrigin(domain.includes("://") ? domain : `https://${domain}`);
}

/** Return a normalized exact origin only when it is explicitly trusted. */
export function allowedLDrawOrigin(
  origin: string | undefined,
  environment: OriginEnvironment = process.env,
): string | undefined {
  const requested = parseOrigin(origin);
  if (!requested) return undefined;

  const allowed = new Set(
    (environment.LDRAW_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map(parseOrigin)
      .filter((value): value is string => Boolean(value)),
  );
  for (const domain of [
    environment.REPLIT_DEV_DOMAIN,
    ...(environment.REPLIT_DOMAINS ?? "").split(","),
  ]) {
    const replitOrigin = originForDomain(domain);
    if (replitOrigin) allowed.add(replitOrigin);
  }

  return allowed.has(requested) ? requested : undefined;
}

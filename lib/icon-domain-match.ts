const COMMON_CCTLD_PUBLIC_SUFFIX_LABELS = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "go",
  "gov",
  "mil",
  "net",
  "ne",
  "or",
  "org",
]);

// These shared hosting domains are registrable boundaries for tenants rather
// than brands themselves. Keep them out of ancestor matches so, for example,
// one tenant's catalog entry can never become the fallback for every tenant.
const COMMON_SHARED_PUBLIC_SUFFIXES = new Set([
  "appspot.com",
  "azurewebsites.net",
  "blogspot.com",
  "cloudfront.net",
  "firebaseapp.com",
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "netlify.app",
  "pages.dev",
  "vercel.app",
  "web.app",
  "workers.dev",
]);

function isPublicSuffixCandidate(domain: string) {
  if (COMMON_SHARED_PUBLIC_SUFFIXES.has(domain)) return true;
  const labels = domain.split(".");
  if (labels.length !== 2) return false;
  const [secondLevel = "", countryCode = ""] = labels;
  return countryCode.length === 2 && COMMON_CCTLD_PUBLIC_SUFFIX_LABELS.has(secondLevel);
}

/**
 * Build exact DNS-label suffixes that may own a catalog icon. The caller
 * supplies an already normalized hostname; invalid labels return no matches.
 * Bare TLDs and common public suffixes are deliberately excluded.
 */
export function catalogDomainMatchCandidates(normalizedHostname: string) {
  const hostname = normalizedHostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (
    labels.length < 2
    || hostname.length > 253
    || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    return [];
  }

  const candidates: string[] = [];
  for (let index = 0; index < labels.length - 1; index += 1) {
    const candidate = labels.slice(index).join(".");
    if (!isPublicSuffixCandidate(candidate)) candidates.push(candidate);
  }
  return candidates;
}

export function catalogDomainMatchesWebsite(normalizedHostname: string, catalogDomain: string) {
  return catalogDomainMatchCandidates(normalizedHostname).includes(catalogDomain.toLowerCase().replace(/\.$/, ""));
}

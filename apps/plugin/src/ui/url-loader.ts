// Loads page HTML for import. `proxyTemplate` is an optional URL containing the
// literal "{url}", which is replaced with encodeURIComponent(targetUrl). With no
// template, a direct fetch is attempted (works only for CORS-permissive targets).
// Returns the HTML text or throws a descriptive Error.

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTML_SNIFF_LEN = 9;

function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  const head = body.trimStart().slice(0, HTML_SNIFF_LEN).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

export async function loadHtmlFromUrl(
  targetUrl: string,
  proxyTemplate?: string
): Promise<string> {
  let fetchUrl = targetUrl;
  if (proxyTemplate) {
    if (!proxyTemplate.includes("{url}")) {
      throw new Error("Proxy template must include {url} placeholder.");
    }
    fetchUrl = proxyTemplate.replace("{url}", encodeURIComponent(targetUrl));
  }

  const response = await fetch(fetchUrl);
  if (response.status < HTTP_OK_MIN || response.status > HTTP_OK_MAX) {
    throw new Error(`Failed to load URL (HTTP ${response.status}).`);
  }

  const body = await response.text();
  if (!looksLikeHtml(response.headers.get("content-type"), body)) {
    throw new Error("That URL did not return HTML.");
  }
  return body;
}

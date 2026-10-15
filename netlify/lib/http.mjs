// Small helpers shared by the Studio functions.
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export function isLocal(req) {
  const host = new URL(req.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

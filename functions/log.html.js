// Cloudflare Pages Function to serve log.html
export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // Check for admin parameter
  const adminParam = url.searchParams.get('admin');
  if (!adminParam) {
    return new Response('Access denied: admin parameter required', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  // Try to fetch log.html from ASSETS
  try {
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetUrl = new URL('/log.html', url.origin);
      const assetRequest = new Request(assetUrl.toString(), {
        method: 'GET',
        headers: request.headers
      });
      return await env.ASSETS.fetch(assetRequest);
    }
  } catch (e) {
    console.error('Error fetching log.html from ASSETS:', e);
  }

  return new Response('log.html not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

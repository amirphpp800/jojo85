
// Cloudflare Pages Function to serve log.html
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  
  // Check for admin parameter
  const adminParam = url.searchParams.get('admin');
  if (!adminParam) {
    return new Response('Access denied: admin parameter required', { 
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  
  // Serve log.html from ASSETS
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    const assetRequest = new Request(new URL('/log.html', url.origin), request);
    return env.ASSETS.fetch(assetRequest);
  }
  
  return new Response('log.html not found', { status: 404 });
}

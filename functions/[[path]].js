import app from '../main.js';

export async function onRequest(context) {
  const { request, env, waitUntil } = context;

  // Delegate all requests to the main app
  if (!app || typeof app.fetch !== 'function') {
    return new Response('Application not initialized', { status: 500 });
  }

  return app.fetch(request, env, { waitUntil });
}

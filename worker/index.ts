export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // Fetch from Cloudflare's static asset binding
    let response = await env.ASSETS.fetch(request);

    // Clone headers to modify
    const newHeaders = new Headers(response.headers);

    // Apply 1-hour Cache-Control for static files
    if (/\.(css|js|html|png|jpg|jpeg|gif|svg|ico|webp)$/i.test(url.pathname)) {
      newHeaders.set("Cache-Control", "public, max-age=3600, must-revalidate");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

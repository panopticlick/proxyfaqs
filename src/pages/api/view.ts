import type { APIRoute } from 'astro';
import { incrementViewCount } from '../../lib/supabase';

export const prerender = false;

/**
 * POST /api/view
 * Increment view count for a question
 * Body: { questionId: string }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const runtimeEnv = (locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env;
    const body = await request.json();
    const { questionId } = body as { questionId?: string };

    if (!questionId || typeof questionId !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid questionId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const newCount = await incrementViewCount(questionId, runtimeEnv);

    return new Response(
      JSON.stringify({
        success: true,
        viewCount: newCount,
        questionId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('View tracking error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { verifyBearer } from '@/lib/auth';
import { getReview, listPendingReviews, postReply } from '@/lib/stamped';
import { readBrandValues } from '@/lib/kb';
import { readArtifactTemplate } from '@/lib/templates';

const jsonText = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

const baseHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'list_pending_reviews',
      {
        title: 'List pending Stamped reviews',
        description:
          'Lists Stamped.io product reviews that have no merchant reply yet, newest first. Use this to find reviews that still need a response.',
        inputSchema: {
          limit: z
            .number()
            .int()
            .positive()
            .max(100)
            .optional()
            .describe('Max number of pending reviews to return (default 20, max 100).'),
          since: z
            .string()
            .optional()
            .describe('Only include reviews created on or after this ISO 8601 date.'),
        },
      },
      async (args) => jsonText(await listPendingReviews(args)),
    );

    server.registerTool(
      'get_review',
      {
        title: 'Get a Stamped review by id',
        description: 'Fetches a single Stamped review by its numeric review id.',
        inputSchema: {
          id: z.string().describe('The Stamped review id (numeric string).'),
        },
      },
      async ({ id }) => jsonText(await getReview(id)),
    );

    server.registerTool(
      'post_reply',
      {
        title: 'Post a merchant reply to a Stamped review',
        description:
          'Posts a merchant reply to a Stamped review. By default the reply is public (visible on the storefront) and emails the customer. Set isPrivate=true to post a private internal-only reply, and notifyByEmail=false to skip the customer email.',
        inputSchema: {
          reviewId: z.string().describe('The Stamped review id to reply to.'),
          message: z.string().min(1).describe('The reply text. Plain text or basic HTML.'),
          isPrivate: z
            .boolean()
            .optional()
            .describe('If true, reply is private (NOT shown on storefront). Defaults to false.'),
          notifyByEmail: z
            .boolean()
            .optional()
            .describe('If true, email the customer about the reply. Defaults to true.'),
        },
      },
      async (args) => jsonText(await postReply(args)),
    );

    server.registerTool(
      'get_brand_values',
      {
        title: 'Get brand voice and reply rules',
        description:
          'Returns the brand voice guidelines and reply rules (from content/values.md). Use this as context when drafting review replies so they sound on-brand.',
        inputSchema: {},
      },
      async () => jsonText(await readBrandValues()),
    );

    server.registerTool(
      'get_artifact_template',
      {
        title: 'Get the canonical artifact template HTML',
        description:
          'Returns a canonical, working Cowork artifact HTML to use as the starting basis for a new artifact. Defaults to the Stamped review-queue template. Use this when building a Stamped review artifact rather than composing one from scratch.',
        inputSchema: {
          name: z
            .string()
            .optional()
            .describe(
              'Template name. Defaults to "stamped-review-queue". Allowed values: "stamped-review-queue".',
            ),
        },
      },
      async ({ name }) => jsonText(await readArtifactTemplate(name)),
    );
  },
  {
    serverInfo: { name: 'claudmcp', version: '0.1.0' },
  },
  {
    basePath: '/api',
    maxDuration: 60,
    disableSse: true,
  },
);

const handler = withMcpAuth(
  baseHandler,
  async (_req, bearerToken) => verifyBearer(bearerToken),
  { required: true },
);

export { handler as GET, handler as POST };

const STAMPED_BASE = 'https://stamped.io/api/v2';

function getStampedEnv() {
  const publicKey = process.env.STAMPED_PUBLIC_KEY;
  const privateKey = process.env.STAMPED_PRIVATE_KEY;
  const storeHash = process.env.STAMPED_STORE_HASH;
  if (!publicKey || !privateKey || !storeHash) {
    throw new Error(
      'Stamped env vars missing (need STAMPED_PUBLIC_KEY, STAMPED_PRIVATE_KEY, STAMPED_STORE_HASH)',
    );
  }
  return { publicKey, privateKey, storeHash };
}

function basicAuthHeader(publicKey: string, privateKey: string): string {
  return 'Basic ' + Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
}

export class StampedError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Stamped API ${status}: ${body.slice(0, 300)}`);
    this.name = 'StampedError';
  }
}

interface RequestOpts {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function stampedRequest<T>(opts: RequestOpts, retried = false): Promise<T> {
  const { publicKey, privateKey, storeHash } = getStampedEnv();
  const url = new URL(`${STAMPED_BASE}/${storeHash}${opts.path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: basicAuthHeader(publicKey, privateKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 429 && !retried) {
    const ra = Number(res.headers.get('Retry-After') ?? '1');
    const waitMs = Math.min(Math.max(ra, 1), 5) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    return stampedRequest<T>(opts, true);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new StampedError(res.status, text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

interface StampedReviewObj {
  id: number;
  author: string;
  email?: string;
  body: string;
  title: string;
  rating: number;
  dateCreated?: string;
  dateAdded?: string;
  dateReplied?: string | null;
  reply?: string | null;
  isPublicReply?: boolean;
  productTitle?: string;
  productId?: number;
}

interface StampedCustomerObj {
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface StampedListItem {
  review: StampedReviewObj;
  customer?: StampedCustomerObj;
}

interface StampedListResponse {
  page: number;
  total: number;
  totalPages: number;
  results: StampedListItem[];
}

export interface Review {
  id: string;
  author: string;
  authorEmail?: string;
  rating: number;
  title: string;
  body: string;
  productName?: string;
  productId?: string;
  createdAt: string;
  hasReply: boolean;
  replyText?: string;
  repliedAt?: string;
  isPublicReply?: boolean;
}

function mapReview(r: StampedReviewObj, c?: StampedCustomerObj): Review {
  const fullName = [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim();
  const replyText = r.reply ?? undefined;
  return {
    id: String(r.id),
    author: r.author || fullName || 'Anonymous',
    authorEmail: r.email || c?.email,
    rating: r.rating,
    title: r.title,
    body: r.body,
    productName: r.productTitle,
    productId: r.productId != null ? String(r.productId) : undefined,
    createdAt: r.dateCreated || r.dateAdded || '',
    hasReply: Boolean(replyText && replyText.trim()),
    replyText,
    repliedAt: r.dateReplied ?? undefined,
    isPublicReply: r.isPublicReply,
  };
}

const SCAN_PAGE_SIZE = 50;
const MAX_PAGES_SCANNED = 10;

export interface ListPendingArgs {
  limit?: number;
  since?: string;
}

export interface ListPendingResult {
  reviews: Review[];
  scannedPages: number;
  totalReviewsInStore: number;
}

export async function listPendingReviews(
  args: ListPendingArgs = {},
): Promise<ListPendingResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
  const sinceMs = args.since ? new Date(args.since).getTime() : undefined;

  const matches: Review[] = [];
  let page = 1;
  let totalPages = 1;
  let totalReviewsInStore = 0;
  let scannedPages = 0;

  while (matches.length < limit && page <= totalPages && scannedPages < MAX_PAGES_SCANNED) {
    const res = await stampedRequest<StampedListResponse>({
      path: '/dashboard/reviews',
      query: { page, take: SCAN_PAGE_SIZE },
    });
    totalReviewsInStore = res.total;
    totalPages = res.totalPages;
    scannedPages++;
    if (page === 1) {
      const counts = {
        page,
        results_len: res.results?.length ?? 0,
        with_reply: 0,
        empty_reply: 0,
        null_reply: 0,
        other: 0,
      };
      for (const item of res.results ?? []) {
        const r = item?.review?.reply;
        if (r === null || r === undefined) counts.null_reply++;
        else if (typeof r === 'string' && r.trim() === '') counts.empty_reply++;
        else if (typeof r === 'string') counts.with_reply++;
        else counts.other++;
      }
      const sample = res.results?.[0]?.review;
      console.log('[mcp] page1 counts:', JSON.stringify(counts));
      console.log(
        '[mcp] page1 sample:',
        JSON.stringify({
          id: sample?.id,
          reply_type: typeof sample?.reply,
          reply_value: sample?.reply,
          dateReplied: sample?.dateReplied,
        }),
      );
    }
    for (const item of res.results) {
      const m = mapReview(item.review, item.customer);
      if (m.hasReply) continue;
      if (sinceMs !== undefined && new Date(m.createdAt).getTime() < sinceMs) continue;
      matches.push(m);
      if (matches.length >= limit) break;
    }
    page++;
  }
  console.log(
    '[mcp] listPendingReviews summary:',
    JSON.stringify({ limit, scannedPages, matches: matches.length, totalReviewsInStore }),
  );

  return { reviews: matches, scannedPages, totalReviewsInStore };
}

export async function getReview(id: string): Promise<Review> {
  const r = await stampedRequest<StampedReviewObj>({
    path: `/dashboard/reviews/${encodeURIComponent(id)}`,
  });
  return mapReview(r);
}

export interface PostReplyArgs {
  reviewId: string;
  message: string;
  isPrivate?: boolean;
  notifyByEmail?: boolean;
}

export interface PostReplyResult {
  ok: boolean;
  message: string;
}

export async function postReply(args: PostReplyArgs): Promise<PostReplyResult> {
  const isPrivate = args.isPrivate ?? false;
  const isEmail = args.notifyByEmail ?? true;
  const echoed = await stampedRequest<string>({
    path: `/dashboard/reviews/${encodeURIComponent(args.reviewId)}/reply`,
    method: 'POST',
    query: { isPrivate, isEmail },
    body: { reply: args.message },
  });
  return { ok: true, message: typeof echoed === 'string' ? echoed : args.message };
}

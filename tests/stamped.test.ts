import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReview, listPendingReviews, postReply, StampedError } from '@/lib/stamped';

const ENV = {
  STAMPED_PUBLIC_KEY: 'pub-test',
  STAMPED_PRIVATE_KEY: 'priv-test',
  STAMPED_STORE_HASH: 'store-test',
};

const EXPECTED_AUTH =
  'Basic ' + Buffer.from(`${ENV.STAMPED_PUBLIC_KEY}:${ENV.STAMPED_PRIVATE_KEY}`).toString('base64');

function makeReview(id: number, opts: { reply?: string | null; dateCreated?: string } = {}) {
  return {
    review: {
      id,
      author: `Author ${id}`,
      email: `author${id}@example.com`,
      body: `Body of ${id}`,
      title: `Title ${id}`,
      rating: 5,
      dateCreated: opts.dateCreated ?? '2026-01-15T00:00:00.000Z',
      dateReplied: opts.reply ? '2026-01-16T00:00:00.000Z' : null,
      reply: opts.reply ?? null,
      productId: 1000 + id,
      productTitle: `Product ${id}`,
    },
    customer: { firstName: 'First', lastName: 'Last', email: `c${id}@example.com` },
  };
}

function listResponse(items: ReturnType<typeof makeReview>[], page: number, totalPages: number) {
  return {
    page,
    total: totalPages * items.length,
    totalPages,
    results: items,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = {
    STAMPED_PUBLIC_KEY: process.env.STAMPED_PUBLIC_KEY,
    STAMPED_PRIVATE_KEY: process.env.STAMPED_PRIVATE_KEY,
    STAMPED_STORE_HASH: process.env.STAMPED_STORE_HASH,
  };
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('listPendingReviews', () => {
  it('filters out reviews that already have a merchant reply', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        listResponse(
          [
            makeReview(1, { reply: 'already replied' }),
            makeReview(2),
            makeReview(3),
            makeReview(4, { reply: '' }),
          ],
          1,
          1,
        ),
      ),
    );

    const result = await listPendingReviews({ limit: 10 });
    expect(result.reviews.map((r) => r.id)).toEqual(['2', '3', '4']);
    expect(result.totalReviewsInStore).toBe(4);
    expect(result.scannedPages).toBe(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    const u = new URL(url as string);
    expect(u.pathname).toBe('/api/v2/store-test/dashboard/reviews');
    expect(u.searchParams.get('page')).toBe('1');
    expect(u.searchParams.get('take')).toBe('50');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: EXPECTED_AUTH });
  });

  it('walks pages until limit unanswered reviews are collected', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(
          listResponse(
            [makeReview(1, { reply: 'r' }), makeReview(2, { reply: 'r' })],
            1,
            2,
          ),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          listResponse([makeReview(3), makeReview(4), makeReview(5)], 2, 2),
        ),
      );

    const result = await listPendingReviews({ limit: 2 });
    expect(result.reviews.map((r) => r.id)).toEqual(['3', '4']);
    expect(result.scannedPages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects the since filter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        listResponse(
          [
            makeReview(1, { dateCreated: '2026-01-01T00:00:00.000Z' }),
            makeReview(2, { dateCreated: '2026-03-01T00:00:00.000Z' }),
          ],
          1,
          1,
        ),
      ),
    );

    const result = await listPendingReviews({ since: '2026-02-01T00:00:00.000Z' });
    expect(result.reviews.map((r) => r.id)).toEqual(['2']);
  });

  it('retries once on 429 with Retry-After', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
      )
      .mockResolvedValueOnce(jsonResponse(listResponse([makeReview(1)], 1, 1)));

    const result = await listPendingReviews({ limit: 5 });
    expect(result.reviews).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getReview', () => {
  it('hits the single-review endpoint and maps the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        id: 42,
        author: 'Jane',
        email: 'jane@example.com',
        body: 'great',
        title: 'Loved it',
        rating: 5,
        dateCreated: '2026-01-15T00:00:00.000Z',
        productId: 99,
        productTitle: 'Widget',
        reply: null,
        dateReplied: null,
      }),
    );

    const review = await getReview('42');
    expect(review).toMatchObject({
      id: '42',
      author: 'Jane',
      authorEmail: 'jane@example.com',
      rating: 5,
      productId: '99',
      productName: 'Widget',
      hasReply: false,
    });
    const u = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(u.pathname).toBe('/api/v2/store-test/dashboard/reviews/42');
  });
});

describe('postReply', () => {
  it('POSTs to the verified reply endpoint with isPrivate + isEmail query and { reply } body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('thanks for the review!'));

    const result = await postReply({
      reviewId: '52148110',
      message: 'thanks for the review!',
      isPrivate: false,
      notifyByEmail: true,
    });

    expect(result).toEqual({ ok: true, message: 'thanks for the review!' });

    const [url, init] = fetchMock.mock.calls[0]!;
    const u = new URL(url as string);
    expect(u.pathname).toBe('/api/v2/store-test/dashboard/reviews/52148110/reply');
    expect(u.searchParams.get('isPrivate')).toBe('false');
    expect(u.searchParams.get('isEmail')).toBe('true');
    const ri = init as RequestInit;
    expect(ri.method).toBe('POST');
    expect(JSON.parse(ri.body as string)).toEqual({ reply: 'thanks for the review!' });
  });

  it('passes isPrivate/isEmail explicitly when defaults are used', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('ok'));

    await postReply({ reviewId: '1', message: 'hi' });
    const u = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(u.searchParams.get('isPrivate')).toBe('false');
    expect(u.searchParams.get('isEmail')).toBe('true');
  });
});

describe('error handling', () => {
  it('throws StampedError on non-2xx (no retry on 500)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('server boom', { status: 500 }),
    );
    await expect(getReview('1')).rejects.toBeInstanceOf(StampedError);
  });

  it('throws when env vars are missing', async () => {
    delete process.env.STAMPED_PUBLIC_KEY;
    await expect(getReview('1')).rejects.toThrow(/STAMPED_PUBLIC_KEY/);
  });
});

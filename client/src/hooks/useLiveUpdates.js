import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openEventStream } from '../lib/api';

// Query-key roots to refresh for a mutation on a given API path
const PATH_INVALIDATE = [
  [/^\/leads/,               ['leads', 'lead', 'lead-meeting']],
  [/^\/clients/,             ['clients', 'client', 'sessions', 'windows', 'payments', 'engagements', 'client-meetings', 'whatsapp-log']],
  [/^\/sessions/,            ['sessions', 'client', 'clients']],
  [/^\/session-windows/,     ['windows', 'client']],
  [/^\/meetings|^\/google/,  ['upcomingMeetings', 'client-meetings', 'lead-meeting', 'sessions']],
  [/^\/menus/,               ['menus', 'client']],
  [/^\/templates/,           ['templates']],
  [/^\/protocols/,           ['protocols']],
  [/^\/payments/,            ['payments', 'clients', 'client']],
];
const ALWAYS = ['dashboard', 'inbox'];

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

/**
 * Keep one SSE connection per tab and invalidate the queries affected by each
 * server-side change (own and other users' mutations, calendar sync, jobs).
 * TanStack only refetches queries that are currently mounted, so broad
 * invalidation is cheap.
 */
export default function useLiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let ctrl = null;
    let retryMs = RECONNECT_MIN_MS;
    let timer = null;
    let stopped = false;

    const invalidate = (roots) => {
      const set = new Set([...ALWAYS, ...roots]);
      queryClient.invalidateQueries({ predicate: (q) => set.has(q.queryKey[0]) });
    };

    const onEvent = (type, data) => {
      retryMs = RECONNECT_MIN_MS; // healthy stream
      if (type === 'mutation') {
        const match = PATH_INVALIDATE.find(([re]) => re.test(data.path || ''));
        invalidate(match ? match[1] : []);
      } else if (type === 'domain') {
        invalidate(Array.isArray(data.invalidate) ? data.invalidate : []);
      }
    };

    const connect = () => {
      if (stopped || !localStorage.getItem('auth_token')) return;
      ctrl = openEventStream(onEvent, () => {
        if (stopped) return;
        timer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
      });
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
    };
  }, [queryClient]);
}

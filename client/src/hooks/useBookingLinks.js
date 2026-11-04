import { useQuery } from '@tanstack/react-query';
import { fetchBookingLinks } from '../lib/api';

/**
 * Google Calendar appointment-scheduling links { firstLink, followupLink },
 * configured on the server (BOOKING_LINK_FIRST / BOOKING_LINK_FOLLOWUP).
 */
export default function useBookingLinks() {
  const { data } = useQuery({
    queryKey: ['bookingLinks'],
    queryFn: fetchBookingLinks,
    staleTime: 10 * 60_000,
  });
  return { firstLink: data?.firstLink || '', followupLink: data?.followupLink || '' };
}

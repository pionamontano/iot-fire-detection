import { useEffect, useState } from 'react';

// Forces a periodic re-render so time-derived UI (e.g. device connectivity
// status computed from last_seen_at) stays fresh even with no new data
// arriving — per spec SW-2.4.3's "30s client re-evaluation" requirement.
export const useNowTick = (intervalMs = 30000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
};

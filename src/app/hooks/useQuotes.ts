// src/hooks/useQuotes.ts
import { useEffect, useState } from "react";

type QuoteMap = Record<string, { price: number | null; changesPercentage: number | null }>;

export function useQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbols?.length) return;
    let ignore = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/market/quotes?symbols=${symbols.join(",")}`, { cache: "no-store" });
        const json = await res.json();
        if (!ignore) {
          if (res.ok && json?.data) setQuotes(json.data);
          else setError(json?.error || `HTTP ${res.status}`);
        }
      } catch (e: any) {
        if (!ignore) setError(String(e?.message || e));
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => { ignore = true; };
  }, [symbols]);

  return { quotes, loading, error };
}
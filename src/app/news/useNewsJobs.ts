// src/app/news/useNewsJobs.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsJobInfo } from "./types";

type UseNewsJobsOptions = {
  pollIntervalMs?: number;
};

export function useNewsJobs(options: UseNewsJobsOptions = {}) {
  const { pollIntervalMs = 4000 } = options;
  const [jobs, setJobs] = useState<NewsJobInfo[]>([]);
  const [polling, setPolling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshJobs = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/news/jobs", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: NewsJobInfo[] };
      if (Array.isArray(data?.jobs)) {
        setJobs(data.jobs);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(() => {
      void refreshJobs();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [polling, pollIntervalMs, refreshJobs]);

  const activeJob = jobs.length > 0 ? jobs[0] : null;
  const jobRunning = Boolean(
    activeJob && (activeJob.status === "pending" || activeJob.status === "running")
  );

  return {
    jobs,
    activeJob,
    jobRunning,
    refreshJobs,
    setPolling,
  };
}

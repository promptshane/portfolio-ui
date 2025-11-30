// src/app/news/viewer/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Header from "../../../components/header";
import type { HighlightRect, NewsHighlight } from "../../types";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

const PDFDocument = dynamic(() => import("react-pdf").then((m) => m.Document), {
  ssr: false,
});
const PDFPage = dynamic(() => import("react-pdf").then((m) => m.Page), {
  ssr: false,
});

type ActionEntry = { type: "add" | "remove"; highlight: NewsHighlight };
type SelectionInfo = { page: number; text: string; rects: HighlightRect[]; signature: string };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function normalizeRect(r: HighlightRect): HighlightRect {
  return {
    x: clamp01(round4(r.x)),
    y: clamp01(round4(r.y)),
    width: clamp01(round4(r.width)),
    height: clamp01(round4(r.height)),
  };
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function signatureFromPayload(payload: { page: number; text: string; rects: HighlightRect[] }) {
  const rects = payload.rects
    .map(normalizeRect)
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const rectSig = rects
    .map((r) => `${r.x.toFixed(4)},${r.y.toFixed(4)},${r.width.toFixed(4)},${r.height.toFixed(4)}`)
    .join(";");
  return `${payload.page}|${normalizeText(payload.text)}|${rectSig}`;
}

function normalizeHighlight(raw: any): NewsHighlight | null {
  if (!raw) return null;
  const rects: HighlightRect[] = Array.isArray(raw.rects)
    ? raw.rects
        .map((r: any) => ({
          x: Number(r?.x),
          y: Number(r?.y),
          width: Number(r?.width),
          height: Number(r?.height),
        }))
        .filter((r: HighlightRect) => Object.values(r).every((v) => Number.isFinite(v)))
        .map(normalizeRect)
    : [];

  if (!rects.length) return null;
  const page = Number(raw.page);
  if (!Number.isInteger(page) || page <= 0) return null;
  const text = typeof raw.text === "string" ? raw.text : "";
  if (!text.trim()) return null;

  return {
    id: Number(raw.id) || 0,
    page,
    text,
    rects,
    signature: typeof raw.signature === "string" ? raw.signature : signatureFromPayload({ page, text, rects }),
    createdAt: raw.createdAt ?? null,
    comment: typeof raw.comment === "string" ? raw.comment : null,
  };
}

export default function NewsPdfViewerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const articleId = useMemo(() => (params?.id ? decodeURIComponent(String(params.id)) : ""), [params]);
  const pdfUrl = useMemo(() => `/api/news/articles/${encodeURIComponent(articleId)}/file`, [articleId]);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<NewsHighlight[]>([]);
  const [loadingHighlights, setLoadingHighlights] = useState(false);
  const [annotationAllowed, setAnnotationAllowed] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ActionEntry[]>([]);
  const [redoStack, setRedoStack] = useState<ActionEntry[]>([]);
  const [selectedHighlight, setSelectedHighlight] = useState<NewsHighlight | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [pageWidth, setPageWidth] = useState(900);
  const [pdfWorkerReady, setPdfWorkerReady] = useState(false);
  const scale = 1.0;
  const [visiblePage, setVisiblePage] = useState(1);

  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const pushUndo = useCallback((action: ActionEntry) => {
    setUndoStack((prev) => [...prev, action]);
    setRedoStack([]);
  }, []);

  const upsertHighlight = useCallback((h: NewsHighlight) => {
    setHighlights((prev) => {
      const seen = new Set<string>();
      const next = prev.filter((p) => {
        const key = p.signature || `id-${p.id}`;
        if (key === (h.signature || `id-${h.id}`)) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const newKey = h.signature || `id-${h.id}`;
      if (!seen.has(newKey)) {
        next.push(h);
      }
      return next;
    });
  }, []);

  const removeHighlightLocal = useCallback((target: NewsHighlight) => {
    setHighlights((prev) =>
      prev.filter(
        (h) =>
          h.id !== target.id &&
          (target.signature ? h.signature !== target.signature : true)
      )
    );
  }, []);

  const fetchHighlights = useCallback(async () => {
    if (!articleId) return;
    setLoadingHighlights(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}/highlights`,
        { cache: "no-store" }
      );
      if (res.status === 401) {
        setAnnotationAllowed(false);
        setHighlights([]);
        setStatus("Sign in to save highlights for this PDF.");
        return;
      }
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || "Failed to load highlights");
      const parsed: NewsHighlight[] = Array.isArray(data?.highlights)
        ? data.highlights
            .map((raw: any) => normalizeHighlight(raw))
            .filter((h: NewsHighlight | null): h is NewsHighlight => !!h)
        : [];
      setHighlights(parsed);
      setAnnotationAllowed(true);
    } catch (err: any) {
      setStatus(err?.message || "Failed to load highlights");
    } finally {
      setLoadingHighlights(false);
    }
  }, [articleId]);

  useEffect(() => {
    void fetchHighlights();
  }, [fetchHighlights]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setHighlights([]);
    setStatus(null);
  }, [articleId]);

  useEffect(() => {
    if (!numPages) return;
    setPageNumber((p) => Math.min(Math.max(1, p), numPages));
  }, [numPages]);

  const scrollToPage = useCallback((page: number) => {
    setPageNumber(page);
    const el = pageRefs.current[page];
    if (el && scrollRef.current) {
      const container = scrollRef.current;
      const top = el.offsetTop - 12;
      container.scrollTo({ top, behavior: "smooth" });
    }
  }, []);

  const scrollHighlightIntoView = useCallback(
    (h: NewsHighlight) => {
      const el = pageRefs.current[h.page];
      const container = scrollRef.current;
      const rect = h.rects?.[0];
      if (el && container && rect) {
        const pageHeight = el.clientHeight || 1;
        const targetTop =
          el.offsetTop + rect.y * pageHeight - container.clientHeight / 2 + rect.height * pageHeight * 0.5;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        setPageNumber(h.page);
      } else {
        scrollToPage(h.page);
      }
    },
    [scrollToPage]
  );

  const createHighlight = useCallback(
    async (payload: SelectionInfo, trackUndo = true) => {
      if (!annotationAllowed) {
        setStatus("Sign in to save highlights for this PDF.");
        return null;
      }
      try {
        const res = await fetch(
          `/api/news/articles/${encodeURIComponent(articleId)}/highlights`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              page: payload.page,
              text: payload.text,
              rects: payload.rects.map(normalizeRect),
              intent: "add",
            }),
          }
        );
        const data = await res.json();
        if (!res.ok || data?.error) throw new Error(data?.error || "Failed to save highlight");
        const newHighlight = normalizeHighlight(data?.highlight ?? payload);
        if (!newHighlight) throw new Error("Invalid highlight response");
        upsertHighlight(newHighlight);
        if (trackUndo) pushUndo({ type: "add", highlight: newHighlight });
        setStatus("Highlight saved");
        return newHighlight;
      } catch (err: any) {
        setStatus(err?.message || "Failed to save highlight");
        return null;
      }
    },
    [annotationAllowed, articleId, pushUndo, upsertHighlight]
  );

  const deleteHighlight = useCallback(
    async (highlight: NewsHighlight, trackUndo = true) => {
      if (!annotationAllowed) return false;
      try {
        const url =
          highlight.id > 0
            ? `/api/news/articles/${encodeURIComponent(articleId)}/highlights?highlightId=${highlight.id}`
            : `/api/news/articles/${encodeURIComponent(articleId)}/highlights`;

        const res = await fetch(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: highlight.id > 0 ? undefined : JSON.stringify({ signature: highlight.signature }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 404) {
          throw new Error(data?.error || "Failed to delete highlight");
        }
        removeHighlightLocal(highlight);
        if (trackUndo) pushUndo({ type: "remove", highlight });
        setStatus("Highlight removed");
        return true;
      } catch (err: any) {
        setStatus(err?.message || "Failed to delete highlight");
        return false;
      }
    },
    [annotationAllowed, articleId, pushUndo, removeHighlightLocal]
  );

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    if (last.type === "add") {
      const removed = await deleteHighlight(last.highlight, false);
      if (removed) {
        setRedoStack((prev) => [...prev, last]);
      }
    } else {
      const added = await createHighlight(
        {
          ...last.highlight,
          signature: last.highlight.signature || signatureFromPayload(last.highlight),
        },
        false
      );
      if (added) {
        setRedoStack((prev) => [...prev, { type: "remove", highlight: added }]);
      }
    }
  }, [undoStack, deleteHighlight, createHighlight]);

  const redo = useCallback(async () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack((prev) => prev.slice(0, -1));
    if (last.type === "add") {
      const added = await createHighlight(
        {
          ...last.highlight,
          signature: last.highlight.signature || signatureFromPayload(last.highlight),
        },
        false
      );
      if (added) pushUndo({ type: "add", highlight: added });
    } else {
      const removed = await deleteHighlight(last.highlight, false);
      if (removed) pushUndo({ type: "remove", highlight: last.highlight });
    }
  }, [redoStack, createHighlight, deleteHighlight, pushUndo]);

  const extractSelection = useCallback((): SelectionInfo | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const ancestor: Node | null = range.commonAncestorContainer;
    const pageEl =
      (ancestor instanceof Element ? ancestor : ancestor?.parentElement)?.closest("[data-page-number]");
    if (!pageEl) return null;
    const pageAttr = pageEl.getAttribute("data-page-number") || "1";
    const page = parseInt(pageAttr, 10);
    if (!Number.isFinite(page) || page <= 0) return null;
    const pageRect = pageEl.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects());
    const rectsRaw = clientRects
      .map((r) => ({
        x: (r.left - pageRect.left) / pageRect.width,
        y: (r.top - pageRect.top) / pageRect.height,
        width: r.width / pageRect.width,
        height: r.height / pageRect.height,
      }))
      .map(normalizeRect)
      .filter((r) => r.width > 0 && r.height > 0);

    // Drop extreme outliers to avoid runaway highlights when dragging
    if (rectsRaw.length > 3) {
      const widths = rectsRaw.map((r) => r.width).sort((a, b) => a - b);
      const heights = rectsRaw.map((r) => r.height).sort((a, b) => a - b);
      const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
      const medW = median(widths);
      const medH = median(heights);
      rectsRaw.splice(
        0,
        rectsRaw.length,
        ...rectsRaw.filter((r) => r.width <= medW * 3 && r.height <= medH * 2)
      );
    }

    let rects: HighlightRect[] = rectsRaw;

    // If nothing survived filtering (e.g., multi-paragraph with gaps), fall back to bounding box
    if (!rectsRaw.length && clientRects.length) {
      const b = range.getBoundingClientRect();
      rects = [
        normalizeRect({
          x: (b.left - pageRect.left) / pageRect.width,
          y: (b.top - pageRect.top) / pageRect.height,
          width: b.width / pageRect.width,
          height: b.height / pageRect.height,
        }),
      ];
    }

    // Merge rects on the same line to avoid per-letter seams
    const merged: HighlightRect[] = [];
    const sorted = [...rects].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (
        last &&
        Math.abs(last.y - r.y) < 0.03 &&
        Math.abs(last.height - r.height) < 0.05 &&
        r.x <= last.x + last.width + 0.02 // gap tolerance
      ) {
        const right = Math.max(last.x + last.width, r.x + r.width);
        last.x = Math.min(last.x, r.x);
        last.width = right - last.x;
        last.height = Math.max(last.height, r.height);
      } else {
        merged.push({ ...normalizeRect(r) });
      }
    }

    // If selection is very short, collapse to a single bounding rect for smoother double-clicks
    if (merged.length && (merged.length <= 2 || text.length <= 25)) {
      const minX = Math.min(...merged.map((r) => r.x));
      const minY = Math.min(...merged.map((r) => r.y));
      const maxX = Math.max(...merged.map((r) => r.x + r.width));
      const maxY = Math.max(...merged.map((r) => r.y + r.height));
      rects = [
        normalizeRect({
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        }),
      ];
    } else {
      rects = merged.map(normalizeRect);
    }
    if (!rects.length) return null;
    const signature = signatureFromPayload({ page, text, rects });
    return { page, text, rects, signature };
  }, []);

  const toggleSelection = useCallback(async () => {
    if (!annotationAllowed) {
      setStatus("Sign in to save highlights for this PDF.");
      return;
    }
    const activeEl = document.activeElement;
    if (
      activeEl &&
      ["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(activeEl.tagName)
    ) {
      return;
    }
    const info = extractSelection();
    if (!info) return;
    const matchesExisting = highlights.find((h) => {
      if (h.page !== info.page) return false;
      if (normalizeText(h.text) !== normalizeText(info.text)) return false;
      // compare first rect overlap; allow small tolerances
      const rectA = info.rects[0];
      const rectB = h.rects[0];
      const overlapX = Math.max(
        0,
        Math.min(rectA.x + rectA.width, rectB.x + rectB.width) - Math.max(rectA.x, rectB.x)
      );
      const overlapY = Math.max(
        0,
        Math.min(rectA.y + rectA.height, rectB.y + rectB.height) - Math.max(rectA.y, rectB.y)
      );
      const areaOverlap = overlapX * overlapY;
      const areaA = rectA.width * rectA.height;
      const areaB = rectB.width * rectB.height;
      const iou = areaOverlap / Math.max(1e-6, areaA + areaB - areaOverlap);
      return iou > 0.7;
    });

    if (matchesExisting) {
      await deleteHighlight(matchesExisting, true);
      if (selectedHighlight?.signature === matchesExisting.signature) {
        setSelectedHighlight(null);
        setCommentDraft("");
      }
    } else {
      const added = await createHighlight(info, true);
      if (added) {
        setSelectedHighlight(added);
        setCommentDraft(added.comment ?? "");
        scrollHighlightIntoView(added);
      }
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
  }, [annotationAllowed, extractSelection, highlights, deleteHighlight, createHighlight, selectedHighlight?.signature, scrollHighlightIntoView]);

  // Keyboard shortcuts: Enter to toggle highlight, Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          void redo();
        } else {
          void undo();
        }
        return;
      }
      if (key === "enter") {
        void toggleSelection();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleSelection, undo, redo]);

  const handleDownload = useCallback(() => {
    let downloadTriggered = false;

    const triggerDirectDownload = () => {
      if (downloadTriggered) return;
      downloadTriggered = true;
      const anchor = document.createElement("a");
      anchor.href = pdfUrl;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.download = "";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 0);
    };

    const win = window.open(pdfUrl, "_blank");
    if (win) {
      const started = Date.now();
      const interval = setInterval(() => {
        try {
          const doc = win.document;
          const downloadBtn =
            doc?.querySelector('button[aria-label="Download"]') ||
            doc?.querySelector('button[title*="Download"]') ||
            doc?.querySelector("#download") ||
            doc?.querySelector('[data-element="download"]') ||
            doc?.querySelector('download');
          if (downloadBtn instanceof HTMLElement) {
            downloadBtn.click();
            downloadTriggered = true;
            clearInterval(interval);
            return;
          }
          if (Date.now() - started > 7000) {
            clearInterval(interval);
            triggerDirectDownload();
          }
        } catch {
          clearInterval(interval);
          triggerDirectDownload();
        }
      }, 400);

      setTimeout(() => {
        if (!downloadTriggered) {
          triggerDirectDownload();
        }
      }, 1800);
    } else {
      triggerDirectDownload();
    }
  }, [pdfUrl]);

  const handlePrint = useCallback(() => {
    const win = window.open(pdfUrl, "_blank");
    if (win) {
      const timer = setInterval(() => {
        if (win.document?.readyState === "complete") {
          clearInterval(timer);
          win.focus();
          win.print();
        }
      }, 300);
    }
  }, [pdfUrl]);

  const highlightByPage = useMemo(() => {
    const map = new Map<number, NewsHighlight[]>();
    for (const h of highlights) {
      if (!map.has(h.page)) map.set(h.page, []);
      map.get(h.page)!.push(h);
    }
    return map;
  }, [highlights]);

  // Ordered list of highlights for navigation
  const sortedHighlights = useMemo(
    () =>
      [...highlights].sort((a, b) =>
        a.page === b.page
          ? (a.createdAt || "").localeCompare(b.createdAt || "")
          : a.page - b.page
      ),
    [highlights]
  );
  const [activeHighlightIdx, setActiveHighlightIdx] = useState(0);
  useEffect(() => {
    setActiveHighlightIdx((idx) => Math.min(Math.max(0, idx), Math.max(0, sortedHighlights.length - 1)));
  }, [sortedHighlights.length]);

  const jumpToHighlight = useCallback(
    (dir: "prev" | "next") => {
      if (!sortedHighlights.length) return;
      setActiveHighlightIdx((idx) => {
        const next =
          dir === "next" ? idx + 1 : idx - 1;
        const wrapped = (next + sortedHighlights.length) % sortedHighlights.length;
        const target = sortedHighlights[wrapped];
        scrollHighlightIntoView(target);
        setSelectedHighlight(target);
        setCommentDraft(target.comment ?? "");
        return wrapped;
      });
    },
    [sortedHighlights, scrollHighlightIntoView]
  );

  const viewerHeight = "calc(100vh - 200px)";

  // Observe container width to keep page width and overlays in sync on resize/layout changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          const next = Math.max(480, Math.min(1100, w - 120));
          setPageWidth(next);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track visible page to gate comment panel
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const handler = () => {
      const mid = container.scrollTop + container.clientHeight / 2;
      let best = Infinity;
      let bestPage = visiblePage;
      Object.entries(pageRefs.current).forEach(([k, el]) => {
        if (!el) return;
        const center = el.offsetTop + el.clientHeight / 2;
        const dist = Math.abs(center - mid);
        if (dist < best) {
          best = dist;
          bestPage = parseInt(k, 10) || bestPage;
        }
      });
      setVisiblePage(bestPage || 1);
    };
    handler();
    container.addEventListener("scroll", handler, { passive: true });
    return () => container.removeEventListener("scroll", handler);
  }, [visiblePage]);

  // Configure worker on client after dynamic import
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("react-pdf");
        const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        mod.pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        if (!cancelled) setPdfWorkerReady(true);
      } catch {
        if (!cancelled) setPdfWorkerReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-6">
      <Header title="PDF Viewer" />

      <div className="mt-4 bg-neutral-800 rounded-2xl border border-neutral-700 shadow-lg">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-700 px-4 py-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm text-neutral-300 hover:text-white"
          >
            ← Back
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-neutral-700 text-sm">
            <button
              type="button"
              onClick={() => scrollToPage(Math.max(1, pageNumber - 1))}
              className="px-2 py-1 rounded border border-neutral-700 hover:border-white disabled:opacity-40"
              disabled={pageNumber <= 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="text-neutral-200">
              Page{" "}
              <input
                type="number"
                value={pageNumber}
                min={1}
                max={numPages ?? undefined}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10);
                  if (Number.isFinite(next) && next >= 1 && (!numPages || next <= numPages)) {
                    scrollToPage(next);
                  }
                }}
                className="w-14 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-right text-white"
              />{" "}
              / {numPages ?? "—"}
            </span>
            <button
              type="button"
              onClick={() =>
                scrollToPage(Math.min(numPages ?? pageNumber + 1, pageNumber + 1))
              }
              className="px-2 py-1 rounded border border-neutral-700 hover:border-white disabled:opacity-40"
              disabled={!numPages || pageNumber >= numPages}
              aria-label="Next page"
            >
              ›
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-neutral-700 text-sm">
            <button
              type="button"
              onClick={undo}
              disabled={!undoStack.length}
              className="px-3 py-1 rounded border border-neutral-700 hover:border-white disabled:opacity-40"
              title="Undo (Cmd/Ctrl+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!redoStack.length}
              className="px-3 py-1 rounded border border-neutral-700 hover:border-white disabled:opacity-40"
              title="Redo (Cmd/Ctrl+Shift+Z)"
            >
              Redo
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-neutral-700 text-sm ml-auto">
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1 rounded border border-neutral-700 hover:border-white"
            >
              Download
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1 rounded border border-neutral-700 hover:border-white"
            >
              Print
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("Clear all highlights for this PDF?")) return;
                try {
                  await fetch(`/api/news/articles/${encodeURIComponent(articleId)}/highlights`, {
                    method: "DELETE",
                  });
                  setHighlights([]);
                  setSelectedHighlight(null);
                  setCommentDraft("");
                  setUndoStack([]);
                  setRedoStack([]);
                  setStatus("Highlights cleared");
                } catch (err: any) {
                  setStatus(err?.message || "Failed to clear highlights");
                }
              }}
              className="px-3 py-1 rounded border border-neutral-700 hover:border-white"
            >
              Clear Highlights
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-neutral-700 text-sm">
            <span className="text-xs text-neutral-300">
              Highlights {sortedHighlights.length ? `${activeHighlightIdx + 1}/${sortedHighlights.length}` : "0"}
            </span>
            <button
              type="button"
              onClick={() => jumpToHighlight("prev")}
              disabled={!sortedHighlights.length}
              className="px-2 py-1 rounded border border-neutral-700 hover:border-white disabled:opacity-40"
              aria-label="Previous highlight"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => jumpToHighlight("next")}
              disabled={!sortedHighlights.length}
              className="px-2 py-1 rounded border border-neutral-700 hover:border-white disabled:opacity-40"
              aria-label="Next highlight"
            >
              ›
            </button>
          </div>
        </div>

        <div className="px-4 py-2 text-sm text-neutral-400 flex flex-wrap items-center gap-3 border-b border-neutral-800">
          <span>Select text and press Enter to toggle a highlight. Highlights are saved per user and persist across sessions.</span>
          {!annotationAllowed && (
            <span className="text-[var(--bad-300)]">Sign in to add highlights.</span>
          )}
          {loadingHighlights && <span>Loading highlights…</span>}
          {status && <span className="text-neutral-300">{status}</span>}
        </div>

        {pdfWorkerReady ? (
        <PDFDocument
          key={pdfUrl}
          file={pdfUrl}
          loading={<div className="text-neutral-400 px-4 py-4">Loading PDF…</div>}
          onLoadSuccess={({ numPages: np }) => {
            setNumPages(np);
            setPdfError(null);
          }}
          onLoadError={(err) => {
            setPdfError(err?.message || "Failed to load PDF");
          }}
        >
          <div className="flex" style={{ height: viewerHeight }}>
            {/* Thumbnails */}
            <aside className="w-32 border-r border-neutral-800 overflow-y-auto bg-neutral-900/40 p-2 hidden sm:block">
              {pdfError && <div className="text-xs text-[var(--bad-300)]">{pdfError}</div>}
              {numPages
                ? Array.from({ length: numPages }).map((_, idx) => {
                    const page = idx + 1;
                    return (
                      <button
                        key={page}
                        type="button"
                        onClick={() => scrollToPage(page)}
                        className={`block w-full mb-3 rounded-lg border ${
                          pageNumber === page ? "border-white" : "border-neutral-700"
                        } overflow-hidden bg-black/60`}
                      >
                        <PDFPage
                          pageNumber={page}
                          width={108}
                          renderAnnotationLayer={false}
                          renderTextLayer={false}
                        />
                        <div className="text-xs text-neutral-300 py-1">Page {page}</div>
                      </button>
                    );
                  })
                : (
                  <div className="text-xs text-neutral-500">Loading pages…</div>
                )}
            </aside>

            {/* Main viewer + comments */}
            <div className="flex-1 flex overflow-hidden bg-neutral-900/30" ref={containerRef}>
              <div
                className="flex-1 overflow-auto px-4 py-4 space-y-6"
                ref={scrollRef}
              >
                {pdfError && <div className="text-[var(--bad-300)]">{pdfError}</div>}
                {numPages &&
                  Array.from({ length: numPages }).map((_, idx) => {
                    const page = idx + 1;
                    const pageHighlights = highlightByPage.get(page) ?? [];
                  return (
                    <div
                      key={page}
                      data-page-number={page}
                      className="relative mx-auto rounded-lg overflow-hidden border border-neutral-800 bg-black/80 shadow"
                      style={{ width: pageWidth + 16 }}
                      ref={(el) => {
                        pageRefs.current[page] = el;
                      }}
                    >
                      <div className="bg-neutral-900 flex justify-center">
                        <PDFPage
                          className="inline-block"
                          pageNumber={page}
                          scale={scale}
                          renderAnnotationLayer={false}
                          renderTextLayer
                          loading={<div className="text-neutral-400 px-4 py-6">Loading page…</div>}
                          width={pageWidth}
                        />
                      </div>
                      <div className="pointer-events-none absolute inset-0">
                        {pageHighlights.map((h) =>
                          h.rects.map((r, i) => {
                            const pad = 1.2; // soften seams / bridge tiny gaps
                            const isSelected = selectedHighlight?.signature === h.signature;
                            return (
                              <div
                                key={`${h.id}-${i}`}
                                className={`absolute mix-blend-multiply rounded-sm ${
                                  isSelected ? "bg-yellow-300/70 ring-2 ring-white/60" : "bg-yellow-300/45"
                                }`}
                                style={{
                                  left: `calc(${r.x * 100}% - ${pad}px)`,
                                  top: `calc(${r.y * 100}% - ${pad}px)`,
                                  width: `calc(${r.width * 100}% + ${pad * 2}px)`,
                                  height: `calc(${r.height * 100}% + ${pad * 2}px)`,
                                }}
                                title={h.text}
                              />
                            );
                          })
                        )}
                      </div>
                      <div className="pointer-events-auto absolute inset-0">
                        {pageHighlights.map((h) =>
                          h.rects.map((r, i) => (
                            <button
                              key={`${h.id}-hit-${i}`}
                              type="button"
                              className="absolute"
                              style={{
                                left: `${r.x * 100}%`,
                                top: `${r.y * 100}%`,
                                width: `${r.width * 100}%`,
                                height: `${r.height * 100}%`,
                              }}
                              onClick={() => {
                                setSelectedHighlight(h);
                                setCommentDraft(h.comment ?? "");
                                setActiveHighlightIdx(
                                  Math.max(
                                    0,
                                    sortedHighlights.findIndex((x) => x.id === h.id || x.signature === h.signature)
                                  )
                                );
                                scrollToPage(h.page);
                              }}
                              aria-label="Highlight"
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Comment panel */}
              <aside
                className={`w-[300px] border-l border-neutral-800 bg-neutral-900/40 p-4 hidden md:block transition-opacity ${
                  selectedHighlight && Math.abs(selectedHighlight.page - visiblePage) <= 1
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none"
                }`}
              >
                {selectedHighlight && Math.abs(selectedHighlight.page - visiblePage) <= 1 ? (
                  <div className="space-y-2">
                    <div className="text-sm text-neutral-200 font-semibold">
                      Comment (Page {selectedHighlight.page})
                    </div>
                    <div className="text-xs text-neutral-400 line-clamp-3">{selectedHighlight.text}</div>
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      className="w-full min-h-[120px] rounded-lg bg-black/60 border border-neutral-700 text-sm text-neutral-100 p-2"
                      placeholder="Add a comment..."
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedHighlight) return;
                          try {
                            const res = await fetch(
                              `/api/news/articles/${encodeURIComponent(articleId)}/highlights`,
                              {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  highlightId: selectedHighlight.id,
                                  comment: commentDraft,
                                }),
                              }
                            );
                            const data = await res.json();
                            if (!res.ok || data?.error) throw new Error(data?.error || "Failed to save comment");
                            const updated: NewsHighlight | null = data?.highlight
                              ? normalizeHighlight(data.highlight)
                              : null;
                            if (updated) {
                              setHighlights((prev) =>
                                prev.map((h) => (h.id === updated.id ? { ...h, comment: updated.comment } : h))
                              );
                              setSelectedHighlight((h) =>
                                h ? { ...h, comment: updated.comment ?? null } : h
                              );
                              setStatus("Comment saved");
                            }
                          } catch (err: any) {
                            setStatus(err?.message || "Failed to save comment");
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-neutral-200 text-black text-sm hover:bg-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCommentDraft(selectedHighlight.comment ?? "");
                        }}
                        className="px-3 py-1.5 rounded-lg border border-neutral-700 text-sm text-neutral-200 hover:border-white"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-neutral-400">Select a highlight to add a comment.</div>
                )}
              </aside>
            </div>
          </div>
        </PDFDocument>
        ) : (
          <div className="px-4 py-6 text-neutral-300">Loading PDF viewer…</div>
        )}
      </div>
    </main>
  );
}

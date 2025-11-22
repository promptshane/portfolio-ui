// src/app/notes/useNotesQa.ts
"use client";

import { useState } from "react";
import type { QaUIState } from "../news/types";
import { mergeEntries, makeLocalId } from "../news/utils";

export function getDefaultQaState(): QaUIState {
  return {
    open: false,
    input: "",
    entries: [],
    loading: false,
    error: null,
  };
}

export function useNotesQa() {
  const [qaById, setQaById] = useState<Record<string, QaUIState>>({});

  async function loadPersistedQa(articleId: string, force = false) {
    let shouldFetch = true;

    if (!force) {
      setQaById((prev) => {
        const prevState = prev[articleId] ?? getDefaultQaState();
        if (prevState.entries.length > 0) {
          shouldFetch = false;
          return prev;
        }
        return prev;
      });
    }

    if (!shouldFetch) return;

    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}`
      );
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as {
        qaHistory?: {
          id?: string;
          question?: string;
          answer?: string | null;
          createdAtISO?: string;
        }[];
      };

      const rawHistory = Array.isArray(data.qaHistory)
        ? data.qaHistory
        : [];

      rawHistory.sort((a, b) => {
        const ta = a?.createdAtISO
          ? new Date(a.createdAtISO).getTime()
          : 0;
        const tb = b?.createdAtISO
          ? new Date(b.createdAtISO).getTime()
          : 0;
        return ta - tb;
      });

      const fromServer = rawHistory
        .map((row) => {
          const question =
            typeof row.question === "string" ? row.question : "";
          const idSource =
            typeof row.id === "string" && row.id.trim().length > 0
              ? row.id.trim()
              : question
              ? `srv-${question}-${row.createdAtISO ?? ""}`
              : "";
          return {
            id: idSource,
            question,
            answer:
              typeof row.answer === "string"
                ? row.answer
                : undefined,
            createdAtISO: row.createdAtISO,
          };
        })
        .filter((e) => e.id && e.question);

      if (!fromServer.length) return;

      setQaById((prev) => {
        const prevState = prev[articleId] ?? getDefaultQaState();
        const merged = mergeEntries(prevState.entries, fromServer);
        return {
          ...prev,
          [articleId]: {
            ...prevState,
            entries: merged,
          },
        };
      });
    } catch {
      return;
    }
  }

  function getQaState(articleId: string): QaUIState {
    return qaById[articleId] ?? getDefaultQaState();
  }

  function toggleQa(articleId: string) {
    const current = qaById[articleId] ?? getDefaultQaState();
    const willOpen = !current.open;

    setQaById((prev) => {
      const prevState = prev[articleId] ?? getDefaultQaState();
      return {
        ...prev,
        [articleId]: {
          ...prevState,
          open: !prevState.open,
          error: null,
        },
      };
    });

    if (willOpen) {
      void loadPersistedQa(articleId);
    }
  }

  function updateQaInput(articleId: string, value: string) {
    setQaById((prev) => {
      const current = prev[articleId] ?? getDefaultQaState();
      return {
        ...prev,
        [articleId]: {
          ...current,
          input: value,
          error: null,
        },
      };
    });
  }

  function addQaQuestion(articleId: string) {
    setQaById((prev) => {
      const current = prev[articleId] ?? getDefaultQaState();
      const text = current.input.trim();
      if (!text) return prev;

      const newEntry = {
        id: makeLocalId(),
        question: text,
      };

      return {
        ...prev,
        [articleId]: {
          ...current,
          input: "",
          error: null,
          entries: [...current.entries, newEntry],
        },
      };
    });
  }

  async function getQaAnswers(articleId: string) {
    const current = qaById[articleId] ?? getDefaultQaState();

    const pendingEntries = current.entries.filter(
      (e) => !e.answer || !e.answer.trim()
    );
    const questions = pendingEntries
      .map((e) => e.question)
      .filter((q) => q && q.trim().length > 0);

    if (!questions.length) {
      setQaById((prev) => {
        const prevState = prev[articleId] ?? current;
        return {
          ...prev,
          [articleId]: {
            ...prevState,
            error: "Add at least one unanswered question first.",
          },
        };
      });
      return;
    }

    const pendingIds = pendingEntries.map((e) => e.id);

    setQaById((prev) => {
      const prevState = prev[articleId] ?? current;
      return {
        ...prev,
        [articleId]: {
          ...prevState,
          loading: true,
          error: null,
        },
      };
    });

    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}`
      , {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "qa", questions }),
        }
      );

      if (!res.ok) {
        let message = `Failed to get answers: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }

      const data = (await res.json()) as {
        answers?: { question: string; answer: string }[];
      };

      const answersArray = Array.isArray(data.answers)
        ? data.answers
        : [];

      setQaById((prev) => {
        const prevState = prev[articleId] ?? current;

        if (answersArray.length !== questions.length) {
          return {
            ...prev,
            [articleId]: {
              ...prevState,
              loading: false,
              error: null,
            },
          };
        }

        const updatedEntries = prevState.entries.map((entry) => {
          const idx = pendingIds.indexOf(entry.id);
          if (idx === -1) return entry;

          const answerObj = answersArray[idx];
          const answerText =
            answerObj && typeof answerObj.answer === "string"
              ? answerObj.answer
              : "";

          return {
            ...entry,
            answer: answerText,
          };
        });

        return {
          ...prev,
          [articleId]: {
            ...prevState,
            entries: updatedEntries,
            loading: false,
            error: null,
          },
        };
      });

      // Sync with persisted history (per-user) so we pick up IDs/timestamps
      void loadPersistedQa(articleId, true);
    } catch (err: any) {
      const message = err?.message || "Failed to get answers.";
      setQaById((prev) => {
        const prevState = prev[articleId] ?? current;
        return {
          ...prev,
          [articleId]: {
            ...prevState,
            loading: false,
            error: message,
          },
        };
      });
    }
  }

  async function deleteQaEntry(articleId: string, questionId: string) {
    const trimmedId = questionId.trim();
    if (!trimmedId) return;

    // Optimistically remove from UI by ID
    setQaById((prev) => {
      const prevState = prev[articleId] ?? getDefaultQaState();
      const remaining = prevState.entries.filter(
        (e) => e.id !== trimmedId
      );
      return {
        ...prev,
        [articleId]: {
          ...prevState,
          entries: remaining,
        },
      };
    });

    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}`
      , {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "deleteQuestion",
            questionId: trimmedId,
          }),
        }
      );

      if (!res.ok) {
        // If delete fails, reload from server to stay consistent.
        void loadPersistedQa(articleId, true);
      }
    } catch {
      void loadPersistedQa(articleId, true);
    }
  }

  return {
    getQaState,
    toggleQa,
    updateQaInput,
    addQaQuestion,
    getQaAnswers,
    deleteQaEntry,
  };
}

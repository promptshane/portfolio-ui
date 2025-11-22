// src/app/notes/types.ts
import type { NewsItem } from "../news/types";

export type NotesRepost = {
  id: string;
  handle: string;
  comment: string;
  tickers: string[];
  createdAtISO: string;
  isMine: boolean;
};

export type NotesFeedItem = {
  id: string; // articleId
  article: NewsItem;
  reposts: NotesRepost[];
};

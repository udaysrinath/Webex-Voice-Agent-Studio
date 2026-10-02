/** Shared by the knowledge-base build (scripts/kb) and the runtime retriever (server/webexone-kb.ts). */
export type CardKind = "session" | "speaker" | "room" | "activity" | "faq" | "info" | "sponsor" | "award" | "product" | "training";

export interface KbCard {
  id: string;
  kind: CardKind;
  /** Short name, also searched. */
  title: string;
  /** Self-contained, answer-ready text (place and time stay together). */
  text: string;
  /** Natural spoken questions this card answers; used for matching, never shown. */
  questions: string[];
  /** Source documents the facts came from (provenance). */
  sources: string[];
  /** Lowercased names of days and rooms the card is about, for exact lookups. */
  days?: string[];
  rooms?: string[];
  /** Extra exact-match terms: session codes, speaker names, abbreviations. */
  aliases?: string[];
}

export interface KbFile {
  version: number;
  builtAt: string;
  embeddingModel: string;
  dimensions: number;
  cards: KbCard[];
}

export interface KbVectors {
  version: number;
  dimensions: number;
  /** One base64 float32 vector per card, in card order: the question side (title + questions). */
  question: string[];
  /** And the content side (text). */
  text: string[];
}

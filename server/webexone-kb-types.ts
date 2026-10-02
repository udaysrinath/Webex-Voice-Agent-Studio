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
  /** One base64 float32 vector per card, in card order: the content side (title + text). */
  text: string[];
  /**
   * One vector per question alias, title and alias term (so a card is matched by its best single phrasing, not a
   * blend of all of them). Unit vectors quantised to int8 (value / 127), concatenated and base64 encoded.
   */
  questions: string;
  /** Card index each question vector belongs to, in order. */
  questionCard: number[];
}

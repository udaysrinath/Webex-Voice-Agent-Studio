import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  llmModel: text("llm_model").notNull(),
  voiceModel: text("voice_model").notNull(),
  language: text("language").notNull(),
  gender: text("gender").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  createdAt: true,
});

export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

export const evaluations = pgTable("evaluations", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  inputText: text("input_text").notNull(),
  naturalness: integer("naturalness").notNull(),
  clarity: integer("clarity").notNull(),
  intonation: integer("intonation").notNull(),
  speed: integer("speed").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEvaluationSchema = createInsertSchema(evaluations).omit({
  id: true,
  createdAt: true,
});

export type InsertEvaluation = z.infer<typeof insertEvaluationSchema>;
export type Evaluation = typeof evaluations.$inferSelect;

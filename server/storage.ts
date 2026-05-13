import { eq, desc, sql } from "drizzle-orm";
import {
  type User,
  type InsertUser,
  type Agent,
  type InsertAgent,
  type Evaluation,
  type InsertEvaluation,
  type WebexRoom,
  type InsertWebexRoom,
  type WebexMessage,
  type InsertWebexMessage,
  type KnowledgeBaseItem,
  type InsertKnowledgeBaseItem,
  users,
  agents,
  evaluations,
  webexRooms,
  webexMessages,
  knowledgeBaseItems,
} from "@shared/schema";

async function createDb() {
  const isNeon = process.env.DATABASE_URL?.includes("neon.tech") || process.env.DATABASE_URL?.includes("neon-");

  if (isNeon) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return drizzle(pool);
  } else {
    const pg = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
    return drizzle(pool);
  }
}

const db = await createDb();

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  createAgent(agent: InsertAgent): Promise<Agent>;
  getAgent(id: number): Promise<Agent | undefined>;
  getAllAgents(): Promise<Agent[]>;
  updateAgent(id: number, agent: Partial<InsertAgent>): Promise<Agent | undefined>;
  deleteAgent(id: number): Promise<boolean>;
  
  createEvaluation(evaluation: InsertEvaluation): Promise<Evaluation>;
  getEvaluationsByAgent(agentId: number): Promise<Evaluation[]>;
  
  upsertWebexRoom(room: InsertWebexRoom): Promise<WebexRoom>;
  getAllWebexRooms(): Promise<WebexRoom[]>;
  
  upsertWebexMessage(message: InsertWebexMessage): Promise<WebexMessage>;
  getWebexMessagesByRoom(roomId: string): Promise<WebexMessage[]>;
  getAllWebexMessages(limit?: number): Promise<WebexMessage[]>;
  getWebexMessageCount(): Promise<number>;

  createKnowledgeBaseItem(item: InsertKnowledgeBaseItem): Promise<KnowledgeBaseItem>;
  getKnowledgeBaseItemsByAgent(agentId: number): Promise<KnowledgeBaseItem[]>;
  updateKnowledgeBaseItem(id: number, title: string, content: string): Promise<KnowledgeBaseItem | null>;
  deleteKnowledgeBaseItem(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createAgent(insertAgent: InsertAgent): Promise<Agent> {
    const existingAgents = await db.select({ id: agents.id }).from(agents).limit(1);
    const values = existingAgents.length === 0
      ? ({ ...insertAgent, id: 1 } as InsertAgent & { id: number })
      : insertAgent;
    const [agent] = await db.insert(agents).values(values).returning();
    await resetAgentsIdSequence();
    return agent;
  }

  async getAgent(id: number): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }

  async getAllAgents(): Promise<Agent[]> {
    return await db.select().from(agents);
  }

  async updateAgent(id: number, updateData: Partial<InsertAgent>): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set(updateData)
      .where(eq(agents.id, id))
      .returning();
    return agent;
  }

  async deleteAgent(id: number): Promise<boolean> {
    await db.delete(evaluations).where(eq(evaluations.agentId, id));
    await db.delete(knowledgeBaseItems).where(eq(knowledgeBaseItems.agentId, id));
    const result = await db.delete(agents).where(eq(agents.id, id)).returning();
    if (result.length > 0) {
      await resetAgentsIdSequence();
    }
    return result.length > 0;
  }

  async createEvaluation(insertEvaluation: InsertEvaluation): Promise<Evaluation> {
    const [evaluation] = await db.insert(evaluations).values(insertEvaluation).returning();
    return evaluation;
  }

  async getEvaluationsByAgent(agentId: number): Promise<Evaluation[]> {
    return await db.select().from(evaluations).where(eq(evaluations.agentId, agentId));
  }

  async upsertWebexRoom(room: InsertWebexRoom): Promise<WebexRoom> {
    const [result] = await db
      .insert(webexRooms)
      .values(room)
      .onConflictDoUpdate({
        target: webexRooms.id,
        set: {
          title: room.title,
          type: room.type,
          lastActivity: room.lastActivity,
          syncedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getAllWebexRooms(): Promise<WebexRoom[]> {
    return await db.select().from(webexRooms).orderBy(desc(webexRooms.lastActivity));
  }

  async upsertWebexMessage(message: InsertWebexMessage): Promise<WebexMessage> {
    const [result] = await db
      .insert(webexMessages)
      .values(message)
      .onConflictDoUpdate({
        target: webexMessages.id,
        set: {
          text: message.text,
          personEmail: message.personEmail,
          personName: message.personName,
          syncedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getWebexMessagesByRoom(roomId: string): Promise<WebexMessage[]> {
    return await db
      .select()
      .from(webexMessages)
      .where(eq(webexMessages.roomId, roomId))
      .orderBy(desc(webexMessages.createdAt));
  }

  async getAllWebexMessages(limit: number = 1000): Promise<WebexMessage[]> {
    return await db
      .select()
      .from(webexMessages)
      .orderBy(desc(webexMessages.createdAt))
      .limit(limit);
  }

  async getWebexMessageCount(): Promise<number> {
    const result = await db.select().from(webexMessages);
    return result.length;
  }

  async createKnowledgeBaseItem(item: InsertKnowledgeBaseItem): Promise<KnowledgeBaseItem> {
    const [result] = await db.insert(knowledgeBaseItems).values(item).returning();
    return result;
  }

  async getKnowledgeBaseItemsByAgent(agentId: number): Promise<KnowledgeBaseItem[]> {
    return await db
      .select()
      .from(knowledgeBaseItems)
      .where(eq(knowledgeBaseItems.agentId, agentId))
      .orderBy(desc(knowledgeBaseItems.createdAt));
  }

  async updateKnowledgeBaseItem(id: number, title: string, content: string): Promise<KnowledgeBaseItem | null> {
    const [result] = await db
      .update(knowledgeBaseItems)
      .set({ title, content })
      .where(eq(knowledgeBaseItems.id, id))
      .returning();
    return result ?? null;
  }

  async deleteKnowledgeBaseItem(id: number): Promise<boolean> {
    const result = await db.delete(knowledgeBaseItems).where(eq(knowledgeBaseItems.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();

async function resetAgentsIdSequence(): Promise<void> {
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('agents', 'id'),
      COALESCE((SELECT MAX(id) FROM agents), 1),
      EXISTS(SELECT 1 FROM agents)
    )
  `);
}

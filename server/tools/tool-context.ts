import type { RetailInventoryItem } from "@shared/use-cases";

export interface RetailToolSession {
  generatedInventory: Map<string, RetailInventoryItem>;
}

export interface ToolExecutionContext {
  retail?: RetailToolSession;
}

export function createRetailToolSession(): RetailToolSession {
  return {
    generatedInventory: new Map<string, RetailInventoryItem>(),
  };
}

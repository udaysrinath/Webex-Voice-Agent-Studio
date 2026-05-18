import { executeTool, type ToolExecutionResult } from "./tools";
import { createRetailToolSession, type ToolExecutionContext } from "./tools/tool-context";
import { RETAIL_STORE_ASSISTANT_USE_CASE } from "@shared/use-cases";

export interface DemoScenarioResult {
  id: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
  durationMs: number;
  toolName?: string;
  error?: string;
}

export interface DemoScenarioRun {
  ranAt: number;
  passed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  results: DemoScenarioResult[];
}

interface DemoScenario {
  id: string;
  label: string;
  expected: string;
  toolName: string;
  args: Record<string, any>;
  validate: (result: ToolExecutionResult) => boolean;
  actual: (result: ToolExecutionResult) => string;
}

export async function runDemoScenarios(): Promise<DemoScenarioRun> {
  const context: ToolExecutionContext = {
    retail: createRetailToolSession(),
  };
  const results: DemoScenarioResult[] = [];

  for (const scenario of createScenarios()) {
    const startedAt = Date.now();
    try {
      const toolResult = await executeTool(scenario.toolName, scenario.args, context);
      const passed = scenario.validate(toolResult);
      results.push({
        id: scenario.id,
        label: scenario.label,
        passed,
        expected: scenario.expected,
        actual: scenario.actual(toolResult),
        durationMs: toolResult.durationMs ?? Date.now() - startedAt,
        toolName: scenario.toolName,
        error: passed ? undefined : toolResult.error,
      });
    } catch (error: any) {
      results.push({
        id: scenario.id,
        label: scenario.label,
        passed: false,
        expected: scenario.expected,
        actual: "Scenario threw before returning a tool result",
        durationMs: Date.now() - startedAt,
        toolName: scenario.toolName,
        error: error?.message || "Unknown scenario error",
      });
    }
  }

  const passed = results.filter((result) => result.passed).length;
  return {
    ranAt: Date.now(),
    passed: passed === results.length,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
    results,
  };
}

function createScenarios(): DemoScenario[] {
  const playbook = RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook;
  return [
    {
      id: "customer-context-loads",
      label: "Customer context loads",
      expected: "Returning customer lookup succeeds without caller-visible setup details",
      toolName: "retail_user_lookup",
      args: { phone: RETAIL_STORE_ASSISTANT_USE_CASE.customer.phone },
      validate: (result) => result.success === true && hasDataValue(result, "preferredStore"),
      actual: (result) => result.result || result.error || "No result text",
    },
    {
      id: "reservation-requires-pickup-time",
      label: "Reservation blocks missing pickup time",
      expected: "Reservation fails safely until both pickup date and time are caller-confirmed",
      toolName: "retail_reserve_item",
      args: {
        product: playbook.reservedItem,
        store: playbook.reservedStore,
      },
      validate: (result) =>
        result.success === false &&
        Boolean((result.data as { pickupDateRequired?: boolean; pickupTimeRequired?: boolean } | undefined)?.pickupDateRequired) &&
        Boolean((result.data as { pickupDateRequired?: boolean; pickupTimeRequired?: boolean } | undefined)?.pickupTimeRequired),
      actual: (result) => result.error || result.result || "No result text",
    },
    {
      id: "unknown-item-fails-gracefully",
      label: "Unavailable item stays in call flow",
      expected: "Unknown or unavailable inventory returns a normal tool failure, not an exception",
      toolName: "retail_reserve_item",
      args: {
        product: "High Power Laser",
        store: "San Jose",
        pickupDate: "Friday",
        pickupTime: "2 PM",
      },
      validate: (result) =>
        result.success === false &&
        typeof result.error === "string" &&
        /not available/i.test(result.error),
      actual: (result) => result.error || result.result || "No result text",
    },
    {
      id: "known-item-reserves",
      label: "Known item can reserve",
      expected: "Known in-stock item confirms a reservation after date and time are present",
      toolName: "retail_reserve_item",
      args: {
        product: "IPAD-PRO-11-M4-256-BLU",
        store: "Palo Alto",
        pickupDate: "Friday",
        pickupTime: "2 PM",
        customerName: RETAIL_STORE_ASSISTANT_USE_CASE.customer.name,
        phone: RETAIL_STORE_ASSISTANT_USE_CASE.customer.phone,
      },
      validate: (result) => result.success === true && /Reservation/.test(result.result || ""),
      actual: (result) => result.result || result.error || "No result text",
    },
    {
      id: "empty-accessory-noop",
      label: "Accessory recommendation can no-op",
      expected: "Missing product context does not force a fabricated upsell",
      toolName: "retail_recommend_gift_accessory",
      args: { product: "" },
      validate: (result) =>
        result.success === true &&
        (result.data as { recommendation?: unknown } | undefined)?.recommendation == null,
      actual: (result) => result.result || result.error || "No result text",
    },
  ];
}

function hasDataValue(result: ToolExecutionResult, key: string): boolean {
  return Boolean(result.data && typeof result.data === "object" && key in result.data);
}

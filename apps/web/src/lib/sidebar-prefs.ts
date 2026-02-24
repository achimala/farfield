import { z } from "zod";

const STORAGE_PREFIX = "farfield.sidebar";

const SidebarOrderSchema = z.array(z.string());
const SidebarCollapseMapSchema = z.record(z.string(), z.boolean());

const GROUP_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];
export const groupColors: readonly string[] = GROUP_COLORS;

const ProjectGroupAssignmentSchema = z.record(z.string(), z.string());

const GroupMetaEntrySchema = z.object({
  name: z.string().min(1),
  color: z.enum(GROUP_COLORS)
}).strict();

const GroupMetaMapSchema = z.record(z.string(), GroupMetaEntrySchema);

export type GroupMetaEntry = z.infer<typeof GroupMetaEntrySchema>;

function readStorage<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.${key}`);
    if (!raw) return fallback;
    return schema.parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}.${key}`, JSON.stringify(value));
  } catch {
    // storage full or unavailable
  }
}

export function readSidebarOrder(): string[] {
  return readStorage("order.v1", SidebarOrderSchema, []);
}

export function writeSidebarOrder(order: string[]): void {
  writeStorage("order.v1", order);
}

export function readCollapseMap(): Record<string, boolean> {
  return readStorage("collapsed-groups.v1", SidebarCollapseMapSchema, {});
}

export function writeCollapseMap(map: Record<string, boolean>): void {
  writeStorage("collapsed-groups.v1", map);
}

export function readProjectGroupAssignments(): Record<string, string> {
  return readStorage("project-groups.v1", ProjectGroupAssignmentSchema, {});
}

export function writeProjectGroupAssignments(map: Record<string, string>): void {
  writeStorage("project-groups.v1", map);
}

export function readGroupMeta(): Record<string, GroupMetaEntry> {
  return readStorage("group-meta.v1", GroupMetaMapSchema, {});
}

export function writeGroupMeta(map: Record<string, GroupMetaEntry>): void {
  writeStorage("group-meta.v1", map);
}

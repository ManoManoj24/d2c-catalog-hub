import type { Role } from "./types";

export type Action =
  | "catalog.write"
  | "catalog.status"
  | "schema.write"
  | "pack.install"
  | "member.manage"
  | "export"
  | "approve";

const MATRIX: Record<Role, readonly string[]> = {
  owner: ["*"],
  admin: ["catalog.write", "catalog.status", "schema.write", "pack.install", "member.manage", "export", "approve"],
  editor: ["catalog.write", "export"],
  reviewer: ["catalog.status", "export", "approve"],
  viewer: ["export"],
};

export function can(role: Role, action: Action): boolean {
  const allowed = MATRIX[role];
  return allowed.includes("*") || allowed.includes(action);
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new Error(`Role ${role} cannot ${action}.`);
  }
}

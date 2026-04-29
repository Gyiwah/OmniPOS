import { UserRole } from "@/src/types/auth";

export function canManageUsers(role: UserRole) {
  return role === "admin" || role === "manager";
}

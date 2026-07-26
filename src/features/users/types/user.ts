/**
 * Users & Roles domain contracts (DEV-049).
 *
 * Write path: create_user / update_user / deactivate_user / assign_role /
 * create_role RPCs.
 * Read path for roles: roles table (no list RPC).
 * No authentication, permissions, JWT, or RLS in this layer.
 */

export interface User {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  created_at: string;
}

export interface CreateUserInput {
  full_name: string;
  email: string;
}

export interface CreateUserResult {
  userId: string;
}

export interface UpdateUserInput {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
}

export interface UpdateUserResult {
  userId: string;
}

export interface DeactivateUserResult {
  userId: string;
  isActive: false;
  alreadyInactive: boolean;
}

export interface AssignRoleInput {
  user_id: string;
  role_id: string;
}

export interface AssignRoleResult {
  userId: string;
  roleId: string;
  roleCode: string;
  alreadyAssigned: boolean;
}

export interface CreateRoleInput {
  code: string;
  name: string;
}

export interface CreateRoleResult {
  roleId: string;
  code: string;
}

export type { ServiceResult } from "@/types/service";

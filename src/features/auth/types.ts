import { AuthUser } from "@/src/types/auth";

export type AuthSession = {
  user: AuthUser | null;
  accessToken: string | null;
};

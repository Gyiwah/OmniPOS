import { create } from "zustand";
import { persist } from "zustand/middleware";

import { api, ApiError, setActiveStore } from "@/api/client";
import { clearLocalData } from "@/db/schema";

export type Membership = { store_id: string; role: string };

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  is_super_admin: boolean;
};

export type StoreSummary = {
  id: string;
  name: string;
  currency: string;
  tax_rate: string;
  vat_rate: string;
  service_rate: string;
  parent_store_id?: string | null;
  is_branch?: boolean;
};

type SessionState = {
  user: SessionUser | null;
  memberships: Membership[];
  storeId: string | null;
  store: StoreSummary | null;
  /** Restoring the session on load, before we know whether we are signed in. */
  booting: boolean;

  role: () => string | null;
  can: (roles: string[]) => boolean;

  login: (email: string, password: string) => Promise<void>;
  restore: () => Promise<void>;
  selectStore: (storeId: string) => Promise<void>;
  logout: () => Promise<void>;
};

/**
 * Session state.
 *
 * The user and their memberships are persisted so the app can render its shell
 * offline — a till that reopens with no connection still knows who is signed in
 * and which store it belongs to. The server session cookie is the real
 * authority; this is a cache to avoid a blank screen, and every request is still
 * authorised server-side.
 */
export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      memberships: [],
      storeId: null,
      store: null,
      booting: true,

      role: () => {
        const { memberships, storeId, user, store } = get();
        if (user?.is_super_admin) return "super_admin";
        const direct = memberships.find((m) => m.store_id === storeId)?.role;
        if (direct === "admin") return "admin";

        // The store admin of the parent store should always be the admin of all the branches
        const parentId = store?.parent_store_id;
        if (parentId) {
          const parentRole = memberships.find((m) => m.store_id === parentId)?.role;
          if (parentRole === "admin") return "admin";
        }

        try {
          const cached = localStorage.getItem("omnipos_accessible_stores");
          if (cached) {
            const stores = JSON.parse(cached) as Array<{ id: string; parent_store_id?: string | null }>;
            const current = stores.find((s) => s.id === storeId);
            if (current?.parent_store_id) {
              const parentRole = memberships.find((m) => m.store_id === current.parent_store_id)?.role;
              if (parentRole === "admin") return "admin";
            }
          }
        } catch {}

        return direct ?? null;
      },

      can: (roles) => {
        const role = get().role();
        return role !== null && (role === "super_admin" || roles.includes(role));
      },

      async login(email, password) {
        const res = await api.post<{ user: SessionUser; memberships: Membership[] }>(
          "/api/auth/login",
          { email, password },
          { storeless: true },
        );

        set({ user: res.user, memberships: res.memberships, booting: false });

        const first = res.memberships[0]?.store_id;
        if (first) await get().selectStore(first);
      },

      async restore() {
        try {
          const res = await api.get<{ user: SessionUser; memberships: Membership[] }>("/api/auth/me", undefined, {
            storeless: true,
          });
          set({ user: res.user, memberships: res.memberships });

          const storeId = get().storeId ?? res.memberships[0]?.store_id ?? null;
          if (storeId) await get().selectStore(storeId);
        } catch (error) {
          const isUnauthenticated = error instanceof ApiError && error.isUnauthenticated;
          if (isUnauthenticated) {
            set({ user: null, memberships: [], storeId: null, store: null });
            setActiveStore(null);
          } else {
            // Offline: Persisted state carries the shell.
            const { storeId } = get();
            if (storeId) setActiveStore(storeId);
          }
        } finally {
          set({ booting: false });
        }
      },

      async selectStore(storeId) {
        const previous = get().storeId;

        // Local data is scoped to one store. Carrying it across a switch would
        // show one shop's stock and prices under another shop's name.
        if (previous && previous !== storeId) {
          await clearLocalData();
        }

        setActiveStore(storeId);
        set({ storeId });

        try {
          const res = await api.get<{ data: StoreSummary }>("/api/store");
          set({ store: res.data });
          try {
            localStorage.setItem(`omnipos_store_cache_${storeId}`, JSON.stringify(res.data));
          } catch {
            // Ignore storage limits
          }
        } catch {
          // Keep the cached store record when offline, or load from store cache
          try {
            const cached = localStorage.getItem(`omnipos_store_cache_${storeId}`);
            if (cached) {
              set({ store: JSON.parse(cached) as StoreSummary });
            }
          } catch {
            // Fallback to existing store record
          }
        }
      },

      /**
       * Sign out must never fail open.
       *
       * The signed-out state is applied FIRST, before any work that can throw.
       * Previously the local wipe ran first, and when it failed the state update
       * never happened — the catalogue was gone but the screen still showed the
       * previous cashier signed in. On a shared till that is the one outcome
       * this function must never produce.
       *
       * The server call and the local wipe are both best-effort: neither can
       * prevent the session from ending on this device.
       */
      async logout() {
        setActiveStore(null);
        set({ user: null, memberships: [], storeId: null, store: null });

        try {
          await api.post("/api/auth/logout", undefined, { storeless: true });
        } catch {
          // Offline sign-out still ends the local session; the server session
          // expires on its own.
        }

        try {
          await clearLocalData();
        } catch {
          // Already signed out on screen; stale local rows are cleared on the
          // next successful sign-in, which wipes on store selection.
        }
      },
    }),
    {
      name: "omnipos.session",
      partialize: (s) => ({ user: s.user, memberships: s.memberships, storeId: s.storeId, store: s.store }),
      onRehydrateStorage: () => (state) => {
        if (state?.storeId) setActiveStore(state.storeId);
      },
    },
  ),
);

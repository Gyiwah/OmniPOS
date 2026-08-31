import { create } from "zustand";
import { persist } from "zustand/middleware";

import { api, setActiveStore } from "@/api/client";
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
        const { memberships, storeId, user } = get();
        if (user?.is_super_admin) return "super_admin";
        return memberships.find((m) => m.store_id === storeId)?.role ?? null;
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
        } catch {
          // Offline, or the session has expired. Persisted state carries the
          // shell; anything needing the network will surface its own error.
          const { storeId } = get();
          if (storeId) setActiveStore(storeId);
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
        } catch {
          // Keep the cached store record when offline.
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

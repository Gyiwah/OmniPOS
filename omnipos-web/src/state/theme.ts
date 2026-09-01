import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeChoice = "system" | "light" | "dark";

type ThemeState = {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  cycle: () => void;
};

const STORAGE_KEY = "omnipos.theme";

/**
 * Which theme the till uses.
 *
 * Dark is the default and stays the default. A till often sits under harsh shop
 * lighting where a white screen is a mirror, and the original stylesheet chose
 * dark for that reason rather than for fashion. Light exists because the other
 * half of the estate is a bright office or a tablet by a window, and "system"
 * exists because a shop that dims its screens at dusk should not have to think
 * about it.
 *
 * Applied to <html> rather than <body>: the browser paints the root element's
 * background before any stylesheet has laid out the page, so putting it here is
 * what stops a white flash on load in dark mode.
 */
function apply(choice: ThemeChoice): void {
  const root = document.documentElement;

  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      choice: "dark",

      setChoice: (choice) => {
        apply(choice);
        set({ choice });
      },

      // Light → dark → system, in that order, so a single control reaches all
      // three without a menu. A till is used with one hand.
      cycle: () => {
        const next: Record<ThemeChoice, ThemeChoice> = { light: "dark", dark: "system", system: "light" };
        get().setChoice(next[get().choice]);
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        // Rehydration happens after the inline script in index.html has already
        // set the attribute, so this only re-asserts it. Both exist because the
        // script prevents the flash and this keeps the store honest.
        if (state) apply(state.choice);
      },
    },
  ),
);

/** Label for the toggle, phrased as what a press will do. */
export function nextThemeLabel(choice: ThemeChoice): string {
  return choice === "light" ? "Switch to dark" : choice === "dark" ? "Match the system" : "Switch to light";
}

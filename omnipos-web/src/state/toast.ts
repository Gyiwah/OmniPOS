import { create } from "zustand";

export type ToastKind = "ok" | "error" | "warn" | "info";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
};

type ToastStore = {
  toasts: ToastItem[];
  showToast: (message: string, kind?: ToastKind) => void;
  removeToast: (id: string) => void;
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  showToast: (message, kind = "ok") => {
    const id = Math.random().toString(36).slice(2, 9);
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (msg: string) => useToastStore.getState().showToast(msg, "ok"),
  error: (msg: string) => useToastStore.getState().showToast(msg, "error"),
  warn: (msg: string) => useToastStore.getState().showToast(msg, "warn"),
  info: (msg: string) => useToastStore.getState().showToast(msg, "info"),
};

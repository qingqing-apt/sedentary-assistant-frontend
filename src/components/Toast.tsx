export type ToastKind = "ok" | "err" | "info";

export type ToastState = { kind: ToastKind; text: string } | null;

export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) {
    return null;
  }
  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}

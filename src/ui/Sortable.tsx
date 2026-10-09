import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

const LONG_PRESS_MS = 450;
const MOVE_SLOP = 10;

interface Drag {
  id: string;
  /** 表示順。指の動きに合わせて入れ替える */
  order: string[];
  y: number;
  raf: number;
}

/**
 * 長押しでつかんで上下に動かし、順番を入れ替えられる一覧。
 * ids は表示順（上から）。離したときに順番が変わっていれば onReorder に新しい表示順を渡す。
 * 並べ替えた直後のタップ（クリック）は中の行に伝えない。
 */
export function Sortable(props: { ids: string[]; onReorder: (ids: string[]) => void; render: (id: string) => ComponentChildren; class?: string }) {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: string; pointerId: number; x: number; y: number; timer: number; target: HTMLElement } | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const displayIds = dragOrder ?? props.ids;

  /** 指の位置に合わせて、つかんでいる行を他の行の間に入れる */
  const moveTo = (y: number) => {
    const d = drag.current;
    const el = listRef.current;
    if (!d || !el) return;
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-id]")].filter((r) => r.dataset.id !== d.id);
    let idx = 0;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      if (y > rect.top + rect.height / 2) idx++;
    }
    const rest = d.order.filter((x) => x !== d.id);
    const next = [...rest.slice(0, idx), d.id, ...rest.slice(idx)];
    if (next.some((x, i) => x !== d.order[i])) {
      d.order = next;
      setDragOrder(next);
    }
  };

  const endDrag = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragId(null);
    setDragOrder(null);
    if (commit) {
      const { ids, onReorder } = latest.current;
      if (d.order.some((x, i) => ids[i] !== x)) onReorder(d.order);
    }
    // 直後の click で行が開かないように
    setTimeout(() => (suppressClick.current = false), 0);
  };

  const cancelPress = () => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  const startDrag = (id: string, y: number, target: HTMLElement, pointerId: number) => {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // 捕まえられなくても、リスト内で動かす分には困らない
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
    suppressClick.current = true;
    const order = [...latest.current.ids];
    drag.current = { id, order, y, raf: 0 };
    setDragId(id);
    setDragOrder(order);
    // 画面の端に近いときは、指を止めていてもスクロールする
    const tick = () => {
      const d = drag.current;
      if (!d) return;
      const edge = 72;
      const h = window.innerHeight;
      if (d.y < edge) window.scrollBy(0, -Math.ceil((edge - d.y) / 6));
      else if (d.y > h - edge) window.scrollBy(0, Math.ceil((d.y - (h - edge)) / 6));
      moveTo(d.y);
      d.raf = requestAnimationFrame(tick);
    };
    drag.current.raf = requestAnimationFrame(tick);
  };

  // 並べ替え中はスクロールさせない（touch-action は触り始めた時点で決まるので、ここで止める）。
  // 指がリストの外で離れたときの取りこぼしも window で拾う
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (drag.current) e.preventDefault();
    };
    const onUp = () => {
      cancelPress();
      endDrag(true);
    };
    const onCancel = () => {
      cancelPress();
      endDrag(false);
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  const onPointerDown = (id: string) => (e: PointerEvent) => {
    if (e.button !== 0 || drag.current) return;
    cancelPress();
    const target = e.currentTarget as HTMLElement;
    const timer = window.setTimeout(() => {
      const p = press.current;
      press.current = null;
      if (p) startDrag(p.id, p.y, p.target, p.pointerId);
    }, LONG_PRESS_MS);
    press.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer, target };
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && (Math.abs(e.clientX - p.x) > MOVE_SLOP || Math.abs(e.clientY - p.y) > MOVE_SLOP)) cancelPress();
    const d = drag.current;
    if (d) {
      d.y = e.clientY;
      moveTo(e.clientY);
    }
  };

  return (
    <div
      class={"sortable " + (props.class ?? "") + (dragId ? " reordering" : "")}
      ref={listRef}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {displayIds.map((id) => (
        <div class={"srow" + (dragId === id ? " dragging" : "")} key={id} data-id={id} onPointerDown={onPointerDown(id)}>
          {props.render(id)}
        </div>
      ))}
    </div>
  );
}

import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { CloseIcon } from "./icons";

/** これ以上下に引いて離したら閉じる（px） */
const CLOSE_DISTANCE = 110;
/** 指がこれだけ動いたら、タップではなく引っぱりとみなす（px） */
const DRAG_SLOP = 6;

/**
 * 画面下から出るシート。背景・右上の × のほか、上端（つまみと見出しのあたり）を下に引いても閉じる。
 * eyebrow は見出しの上に小さく出す補足（試合番号など）。
 */
export function Sheet(props: { title: string; eyebrow?: string; onClose: () => void; children: ComponentChildren }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y0: number; dy: number; active: boolean } | null>(null);

  const setShift = (dy: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.2s ease-out" : "none";
    el.style.transform = dy ? `translateY(${dy}px)` : "";
  };

  // 引っぱり中の動きは window で拾う（指やマウスが上端の外に出ても追いかける）。
  // 上端の要素で捕まえないので、× ボタンのタップはそのまま通る
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag.current) return;
    const d = { pointerId: e.pointerId, y0: e.clientY, dy: 0, active: false };
    drag.current = d;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      d.dy = Math.max(0, ev.clientY - d.y0);
      if (!d.active && d.dy > DRAG_SLOP) {
        d.active = true;
        window.getSelection()?.removeAllRanges();
      }
      if (d.active) setShift(d.dy, false);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      drag.current = null;
      if (!d.active) return;
      if (ev.type === "pointerup" && d.dy > CLOSE_DISTANCE) {
        setShift(window.innerHeight, true);
        setTimeout(props.onClose, 180);
      } else {
        setShift(0, true);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div class="sheet-bg" onClick={props.onClose}>
      <div class="sheet" ref={sheetRef} role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet-top" onPointerDown={onPointerDown}>
          <div class="grip" />
          <div class="sheet-head">
            <div class="grow">
              {props.eyebrow && <div class="eyebrow">{props.eyebrow}</div>}
              <h2>{props.title}</h2>
            </div>
            <button class="btn icon bare" aria-label="閉じる" onClick={props.onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

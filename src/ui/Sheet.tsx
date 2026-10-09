import type { ComponentChildren } from "preact";
import { CloseIcon } from "./icons";

/**
 * 画面下から出るシート。背景か右上の × で閉じる。
 * eyebrow は見出しの上に小さく出す補足（コート番号・試合番号など）。
 */
export function Sheet(props: { title: string; eyebrow?: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-bg" onClick={props.onClose}>
      <div class="sheet" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
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
        {props.children}
      </div>
    </div>
  );
}

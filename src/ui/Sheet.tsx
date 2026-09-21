import type { ComponentChildren } from "preact";

/** 画面下から出る簡易ダイアログ。背景をタップすると閉じる。 */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-bg" onClick={props.onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

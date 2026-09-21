import { useEffect, useRef } from "preact/hooks";

export interface WheelOption<T> {
  value: T;
  label: string;
}

const ITEM_H = 36;
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ITEM_H;

/**
 * ドラムロール式の選択。スクロールして止まった位置の項目が選ばれる。
 * 項目をタップしてもそこへ移動する。
 */
export function Wheel<T>(props: { options: WheelOption<T>[]; value: T; onChange: (v: T) => void; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const reported = useRef<T | undefined>(undefined);
  const mounted = useRef(false);
  const index = Math.max(
    0,
    props.options.findIndex((o) => o.value === props.value),
  );

  // 外から value が変わったときだけ位置を合わせる（自分で報告した変更には反応しない）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const own = reported.current !== undefined && reported.current === props.value;
    reported.current = undefined;
    if (own) return;
    const top = index * ITEM_H;
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTo({ top, behavior: mounted.current ? "smooth" : "auto" });
    mounted.current = true;
  }, [index, props.value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onScroll = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(props.options.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      if (i !== index) {
        reported.current = props.options[i].value;
        props.onChange(props.options[i].value);
      }
    }, 150);
  };

  const jump = (i: number) => ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" });

  return (
    <div class={"wheel-wrap " + (props.class ?? "")} style={`height:${ITEM_H * VISIBLE}px`}>
      <div class="wheel" ref={ref} onScroll={onScroll} style={`scroll-padding-top:${PAD}px`}>
        <div style={`height:${PAD}px`} />
        {props.options.map((o, i) => (
          <div class={"wheel-item" + (i === index ? " on" : "")} key={i} style={`height:${ITEM_H}px`} onClick={() => jump(i)}>
            {o.label}
          </div>
        ))}
        <div style={`height:${PAD}px`} />
      </div>
    </div>
  );
}

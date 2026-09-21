import { useEffect, useState } from "preact/hooks";
import { BUILD, applyUpdate, checkForUpdate, describe, type UpdateCheck } from "../version";

/** 設定タブの「このアプリ」。いまの版と、公開先の最新版の確認・更新。 */
export function UpdateCard(props: { autoCheck?: boolean }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);

  const run = async () => {
    setBusy(true);
    setCheck(await checkForUpdate());
    setBusy(false);
  };

  useEffect(() => {
    if (props.autoCheck) void run();
  }, [props.autoCheck]);

  const apply = async () => {
    setApplying(true);
    await applyUpdate();
  };

  let message: string;
  if (check === null) message = busy ? "確認しています…" : "";
  else if (check.status === "latest") message = "最新版です。";
  else if (check.status === "newer") message = `新しい版があります: ${describe(check.latest)}`;
  else if (check.status === "offline") message = "オフラインのため確認できません。";
  else message = `確認できませんでした（${check.reason}）。`;

  return (
    <div class="card stack">
      <h2>このアプリ</h2>
      <div class="muted">いまの版: {describe(BUILD)}</div>
      {message && <div class={check?.status === "newer" ? "" : "muted"}>{message}</div>}
      <div class="row wrap">
        <button class="btn" onClick={run} disabled={busy || applying}>更新を確認</button>
        {check?.status === "newer" && (
          <button class="btn primary" onClick={apply} disabled={applying}>
            {applying ? "更新しています…" : "最新版に更新"}
          </button>
        )}
      </div>
      <div class="muted">
        GitHub Pages に配信されている最新の版と比べます。更新してもデータは消えません。
        <br />
        <a href="https://github.com/mikanta632/doubles_kun_mobile" target="_blank" rel="noopener">ソースコード（GitHub）</a>
      </div>
    </div>
  );
}

/** 起動時に一度だけ確認して、新しい版があれば画面上部に知らせる。 */
export function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    void checkForUpdate().then((c) => {
      if (alive && c.status === "newer") setLatest(describe(c.latest));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (latest === null || dismissed) return null;
  return (
    <div class="banner">
      <span class="grow">新しい版があります（{latest}）</span>
      <button class="btn small primary" disabled={applying} onClick={() => { setApplying(true); void applyUpdate(); }}>
        {applying ? "更新中…" : "更新"}
      </button>
      <button class="btn small ghost" onClick={() => setDismissed(true)}>あとで</button>
    </div>
  );
}

import { useEffect, useState } from "preact/hooks";
import { BUILD, applyUpdate, checkForUpdate, describe, type UpdateCheck } from "../version";
import { ExternalIcon } from "./icons";

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
  else if (check.status === "newer") message = `新しいバージョンがあります: ${describe(check.latest)}`;
  else if (check.status === "offline") message = "オフラインのため確認できません。";
  else message = `確認できませんでした（${check.reason}）。`;

  return (
    <section class="section">
      <div class="section-h"><h2>このアプリ</h2></div>
      <div class="panel">
        <div class="lrow static">
          <span class="body">
            <span>バージョン</span>
            <span class="sub mono">{describe(BUILD)}</span>
            {message && <span class="sub" style={check?.status === "newer" ? "color:var(--ink);font-weight:600" : ""}>{message}</span>}
          </span>
          {check?.status === "newer" ? (
            <button class="btn primary" onClick={apply} disabled={applying}>{applying ? "更新しています…" : "最新版に更新"}</button>
          ) : (
            <button class="btn" onClick={run} disabled={busy || applying}>更新を確認</button>
          )}
        </div>
        <a class="lrow" href="https://github.com/mikanta632/doubles_kun_mobile" target="_blank" rel="noopener">
          <span class="body">GitHub</span>
          <span class="chev"><ExternalIcon /></span>
        </a>
      </div>
    </section>
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
    <div class="banner" role="status">
      <span class="grow">新しいバージョンがあります（<span class="mono">{latest}</span>）</span>
      <button class="btn text" onClick={() => setDismissed(true)}>あとで</button>
      <button class="btn primary" disabled={applying} onClick={() => { setApplying(true); void applyUpdate(); }}>
        {applying ? "更新中…" : "更新"}
      </button>
    </div>
  );
}

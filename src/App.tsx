import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

type ItemKind = "pumpkin" | "gold" | "ghost";

type FallingItem = {
  id: number;
  kind: ItemKind;
  x: number; // 左端位置 (%)
  y: number; // 上端位置 (px)
  speed: number; // px / 秒
  size: number; // px
};

type Status = "ready" | "playing" | "over";

const BASKET_WIDTH = 84; // px
const BASKET_ZONE = 64; // 地面からこの高さでキャッチ判定
const HIGH_KEY = "pumpkin-catch-high-score";

const EMOJI: Record<ItemKind, string> = {
  pumpkin: "🎃",
  gold: "🌟",
  ghost: "👻",
};

let nextId = 1;

function beep(freq: number, ms: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
    osc.onended = () => void ctx.close();
  } catch {
    // 音が出ない環境ではそのまま続行
  }
}

export default function App() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const basketXRef = useRef(50); // 中心位置 (%)
  const itemsRef = useRef<FallingItem[]>([]);
  const statusRef = useRef<Status>("ready");
  const elapsedRef = useRef(0);
  const spawnRef = useRef(0);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  const [status, setStatus] = useState<Status>("ready");
  const [items, setItems] = useState<FallingItem[]>([]);
  const [basketX, setBasketX] = useState(50);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [high, setHigh] = useState<number>(() => {
    const v = Number(localStorage.getItem(HIGH_KEY));
    return Number.isFinite(v) ? v : 0;
  });

  const setStatusBoth = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const gameOver = useCallback(() => {
    setStatusBoth("over");
    setScore((prev) => {
      setHigh((h) => {
        const nh = Math.max(h, prev);
        localStorage.setItem(HIGH_KEY, String(nh));
        return nh;
      });
      return prev;
    });
  }, [setStatusBoth]);

  const loop = useCallback(
    (ts: number) => {
      if (statusRef.current !== "playing") return;
      const field = fieldRef.current;
      const height = field?.clientHeight ?? 520;
      const width = field?.clientWidth ?? 360;
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;
      elapsedRef.current += dt;

      // スポーン: 時間経過で少しずつ速く・多く
      spawnRef.current -= dt;
      const spawnInterval = Math.max(0.42, 0.85 - elapsedRef.current * 0.006);
      if (spawnRef.current <= 0) {
        spawnRef.current = spawnInterval;
        const r = Math.random();
        const kind: ItemKind = r < 0.14 ? "ghost" : r < 0.24 ? "gold" : "pumpkin";
        const base = 150 + elapsedRef.current * 2.2;
        itemsRef.current = [
          ...itemsRef.current,
          {
            id: nextId++,
            kind,
            x: 4 + Math.random() * 88,
            y: -48,
            speed: base * (0.85 + Math.random() * 0.5),
            size: kind === "gold" ? 34 : 42,
          },
        ];
      }

      const basketCenterPx = (basketXRef.current / 100) * width;
      const catchTop = height - BASKET_ZONE;
      let lostLife = 0;
      let gained = 0;
      const next: FallingItem[] = [];
      for (const it of itemsRef.current) {
        const ny = it.y + it.speed * dt;
        const itemCenterPx = (it.x / 100) * width + it.size / 2;
        const inZone = ny + it.size >= catchTop && ny < height - 8;
        if (inZone && Math.abs(itemCenterPx - basketCenterPx) <= BASKET_WIDTH / 2 + 6) {
          if (it.kind === "ghost") {
            lostLife += 1;
            beep(160, 180);
          } else {
            gained += it.kind === "gold" ? 30 : 10;
            beep(it.kind === "gold" ? 1180 : 880, 90);
          }
          continue;
        }
        if (ny > height) {
          if (it.kind !== "ghost") lostLife += 1;
          continue;
        }
        next.push({ ...it, y: ny });
      }
      itemsRef.current = next;
      setItems(next);
      if (gained > 0) setScore((s) => s + gained);
      if (lostLife > 0) {
        setLives((lv) => {
          const nl = lv - lostLife;
          if (nl <= 0) {
            gameOver();
            return 0;
          }
          return nl;
        });
      }
      rafRef.current = requestAnimationFrame(loop);
    },
    [gameOver],
  );

  const start = useCallback(() => {
    itemsRef.current = [];
    setItems([]);
    setScore(0);
    setLives(3);
    elapsedRef.current = 0;
    spawnRef.current = 0.3;
    lastTsRef.current = performance.now();
    setStatusBoth("playing");
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop, setStatusBoth]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const moveBasket = useCallback((clientX: number) => {
    const field = fieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const halfPct = (BASKET_WIDTH / 2 / rect.width) * 100;
    const clamped = Math.min(100 - halfPct, Math.max(halfPct, pct));
    basketXRef.current = clamped;
    setBasketX(clamped);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (statusRef.current !== "playing") return;
      const step = 6;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const delta = e.key === "ArrowLeft" ? -step : step;
        const nx = Math.min(96, Math.max(4, basketXRef.current + delta));
        basketXRef.current = nx;
        setBasketX(nx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="app">
      <header className="hud">
        <h1>🎃 かぼちゃキャッチ大作戦</h1>
        <div className="hud-row">
          <span>スコア {score}</span>
          <span>ハイスコア {high}</span>
          <span aria-label="のこりライフ">
            {"❤️".repeat(lives)}
            {"🖤".repeat(Math.max(0, 3 - lives))}
          </span>
        </div>
      </header>

      <div
        className="field"
        ref={fieldRef}
        onPointerMove={(e) => status === "playing" && moveBasket(e.clientX)}
        onPointerDown={(e) => status === "playing" && moveBasket(e.clientX)}
        role="application"
        aria-label="ゲームフィールド"
      >
        <div className="moon" aria-hidden="true">
          🌕
        </div>
        {items.map((it) => (
          <div
            key={it.id}
            className="falling"
            style={{
              left: `${it.x}%`,
              top: it.y,
              fontSize: it.size,
            }}
            aria-hidden="true"
          >
            {EMOJI[it.kind]}
          </div>
        ))}
        <div
          className="basket"
          style={{ left: `calc(${basketX}% - ${BASKET_WIDTH / 2}px)` }}
          aria-hidden="true"
        >
          🧺
        </div>
        <div className="ground" aria-hidden="true" />

        {status !== "playing" && (
          <div className="overlay">
            {status === "ready" ? (
              <>
                <p className="overlay-title">かぼちゃをキャッチしよう！</p>
                <p className="overlay-text">
                  🎃 は +10点、🌟 は +30点。
                  <br />
                  カボチャを取り逃がすか、👻 を取るとライフが減ります。
                  <br />
                  カゴは指・ マウス・ ←→キーで動きます。
                </p>
              </>
            ) : (
              <>
                <p className="overlay-title">ゲームオーバー</p>
                <p className="overlay-text">
                  スコア {score} 点
                  {score >= high && score > 0 ? "（ハイスコア更新！）" : ""}
                </p>
              </>
            )}
            <button type="button" className="start-btn" onClick={start}>
              {status === "ready" ? "スタート" : "もう一度遊ぶ"}
            </button>
          </div>
        )}
      </div>

      <p className="hint">
        ルール: ライフは3つ。時間がたつほど落ちるスピードが上がります。
      </p>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe2, Palette, Search, Type, X } from "lucide-react";
import { brandSourceLabels, type BrandChoice } from "../../lib/brand-options";
import {
  MAX_MONOGRAM_GRAPHEMES,
  monogramAccent,
  monogramGraphemeCount,
  monogramIconId,
  monogramTextFromIconId,
  normalizeMonogramText,
} from "../../lib/monogram-icon";
import { BrandIcon } from "./BrandIcon";

type BrandPickerProps = {
  value: BrandChoice;
  website: string;
  onChange: (choice: BrandChoice) => void;
  onWebsiteChange: (website: string) => void;
};

const monogramSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const MONOGRAM_COLORS = [
  { value: "2768ed", label: "钴蓝" },
  { value: "147dce", label: "海蓝" },
  { value: "0f8f83", label: "青绿" },
  { value: "526a14", label: "橄榄绿" },
  { value: "b3541e", label: "陶土橙" },
  { value: "b53b72", label: "莓红" },
  { value: "6d5ce7", label: "鸢尾紫" },
  { value: "202938", label: "深墨" },
] as const;

function normalizedMonogramColor(raw: string | null | undefined, fallback: string = MONOGRAM_COLORS[0].value) {
  const value = raw?.trim().replace(/^#/, "").toLowerCase() ?? "";
  return /^[0-9a-f]{6}$/.test(value) ? value : fallback;
}

function choiceKey(choice: BrandChoice) {
  return choice.iconId ?? `legacy:${choice.iconKey}`;
}

function sourceLabel(choice: BrandChoice) {
  return choice.sourceLabel ?? brandSourceLabels[choice.source] ?? choice.source;
}

function websiteFromQuery(rawQuery: string) {
  const raw = rawQuery.trim();
  const looksLikeWebsite = /^https?:\/\//i.test(raw)
    || /^[^\s/@]+\.[^\s/]{2,}(?:[/?#].*)?$/u.test(raw);
  if (!looksLikeWebsite) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
    return { value: url.toString(), hostname: url.hostname };
  } catch {
    return null;
  }
}

function monogramPreview(raw: string, accent: string) {
  const count = monogramGraphemeCount(raw);
  if (!raw.trim()) return { choice: null, count, error: "" } as const;
  try {
    const text = normalizeMonogramText(raw);
    const normalizedAccent = normalizedMonogramColor(accent, monogramAccent(text));
    const iconId = monogramIconId(text, normalizedAccent);
    return {
      choice: {
        iconId,
        iconKey: iconId,
        title: text,
        accent: normalizedAccent,
        source: "monogram",
        sourceLabel: "字母图标",
      } satisfies BrandChoice,
      count,
      error: "",
    } as const;
  } catch (previewError) {
    return {
      choice: null,
      count,
      error: previewError instanceof Error ? previewError.message : "字母图标格式不正确",
    } as const;
  }
}

function limitMonogramDraft(raw: string) {
  const compact = raw.normalize("NFKC").replace(/\p{White_Space}+/gu, "");
  return Array.from(monogramSegmenter.segment(compact), ({ segment }) => segment)
    .slice(0, MAX_MONOGRAM_GRAPHEMES)
    .join("");
}

export function BrandPicker({ value, website, onChange, onWebsiteChange }: BrandPickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"browse" | "monogram">("browse");
  const [query, setQuery] = useState("");
  const [monogramDraft, setMonogramDraft] = useState("");
  const [monogramColor, setMonogramColor] = useState<string>(MONOGRAM_COLORS[0].value);
  const [monogramColorTouched, setMonogramColorTouched] = useState(false);
  const [results, setResults] = useState<BrandChoice[]>([]);
  const [candidate, setCandidate] = useState<BrandChoice>(value);
  const [candidateWebsite, setCandidateWebsite] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [creatingMonogram, setCreatingMonogram] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const monogramRef = useRef<HTMLInputElement>(null);
  const creatingMonogramRef = useRef(false);
  const monogramComposingRef = useRef(false);
  const websiteQuery = websiteFromQuery(query);
  const monogram = monogramPreview(monogramDraft, monogramColor);
  const monogramColorIsCustom = !MONOGRAM_COLORS.some(({ value: color }) => color === monogramColor);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (mode === "monogram") monogramRef.current?.focus();
      else searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, open]);

  useEffect(() => {
    if (!open || mode !== "browse") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (websiteFromQuery(query)) {
        setResults([]);
        setLoading(false);
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/brands/search?q=${encodeURIComponent(query)}&limit=24`, { signal: controller.signal });
        const body = await response.json() as { items?: BrandChoice[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "图标搜索失败");
        setResults(body.items ?? []);
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") setError(requestError instanceof Error ? requestError.message : "图标搜索失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, open, query]);

  function closePicker() {
    setOpen(false);
    setMode("browse");
    setQuery("");
    setMonogramDraft("");
    setMonogramColor(MONOGRAM_COLORS[0].value);
    setMonogramColorTouched(false);
    monogramComposingRef.current = false;
    setCandidate(value);
    setCandidateWebsite(null);
    setError("");
    setNotice("");
  }

  function openMonogramBuilder() {
    const existingText = monogramTextFromIconId(value.iconId) ?? "";
    setMode("monogram");
    setMonogramDraft(existingText);
    setMonogramColor(normalizedMonogramColor(value.source === "monogram" ? value.accent : null, existingText ? monogramAccent(existingText) : MONOGRAM_COLORS[0].value));
    setMonogramColorTouched(value.source === "monogram");
    monogramComposingRef.current = false;
    setCandidateWebsite(null);
    setError("");
    setNotice("");
  }

  function returnToBrowse() {
    setMode("browse");
    setMonogramDraft("");
    setMonogramColor(MONOGRAM_COLORS[0].value);
    setMonogramColorTouched(false);
    monogramComposingRef.current = false;
    setError("");
  }

  function updateMonogramDraft(raw: string) {
    const nextDraft = limitMonogramDraft(raw);
    setMonogramDraft(nextDraft);
    if (!monogramColorTouched && nextDraft) {
      try { setMonogramColor(monogramAccent(nextDraft)); } catch { /* validation copy is rendered below */ }
    }
    setError("");
  }

  async function discoverWebsiteIcon() {
    setError("");
    setNotice("");
    const target = websiteFromQuery(query);
    if (!target) {
      setError("请输入完整官网地址，例如 dmit.io");
      return;
    }
    setDiscovering(true);
    try {
      const response = await fetch("/api/icons/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: target.value }),
      });
      const body = await response.json() as { icon?: BrandChoice; error?: string } & Partial<BrandChoice>;
      if (!response.ok) throw new Error(body.error ?? "没有从官网找到可用图标");
      const discovered = (body.icon ?? body) as BrandChoice;
      if (!discovered.iconId) throw new Error("官网图标没有写入服务端索引");
      setCandidate(discovered);
      setResults((current) => [discovered, ...current.filter((item) => choiceKey(item) !== choiceKey(discovered))]);
      setCandidateWebsite(target.value);
      setNotice(`已从 ${discovered.domain ?? target.hostname} 获取，确认后使用`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "官网图标获取失败");
    } finally {
      setDiscovering(false);
    }
  }

  async function confirmMonogram() {
    if (creatingMonogramRef.current) return;
    if (!monogram.choice) {
      setError(monogram.error || "请输入 1–5 个字符");
      return;
    }
    creatingMonogramRef.current = true;
    setCreatingMonogram(true);
    setError("");
    try {
      const response = await fetch("/api/icons/monogram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: monogram.choice.title, accent: monogramColor }),
      });
      const body = await response.json() as { icon?: BrandChoice; error?: string };
      if (!response.ok) throw new Error(body.error ?? "字母图标创建失败");
      if (!body.icon?.iconId || body.icon.source !== "monogram") throw new Error("字母图标没有写入服务端索引");
      onChange(body.icon);
      const target = websiteFromQuery(query);
      if (target) onWebsiteChange(target.value);
      closePicker();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "字母图标创建失败");
    } finally {
      creatingMonogramRef.current = false;
      setCreatingMonogram(false);
    }
  }

  return (
    <div className="brand-picker">
      <div className="brand-picker-label"><span>图标</span></div>
      <div className="brand-current">
        <BrandIcon iconId={value.iconId} iconKey={value.iconKey} accent={value.accent} size={48} />
        <div className="brand-current-copy"><strong>{value.title}</strong><span>{sourceLabel(value)}</span></div>
        <button type="button" onClick={() => { const existingText = monogramTextFromIconId(value.iconId) ?? ""; setMode("browse"); setCandidate(value); setCandidateWebsite(null); setMonogramDraft(existingText); setMonogramColor(normalizedMonogramColor(value.source === "monogram" ? value.accent : null, existingText ? monogramAccent(existingText) : MONOGRAM_COLORS[0].value)); setMonogramColorTouched(value.source === "monogram"); setQuery(value.source === "website" ? website : ""); setOpen(true); }}>选择图标</button>
      </div>

      {open && (
        <section className="brand-search-panel" aria-label="搜索并选择图标">
          <div className={`brand-search-head${mode === "browse" && websiteQuery ? " has-discovery" : ""}`}>
            {mode === "browse" ? (
              <label>
                {websiteQuery ? <Globe2 size={17} /> : <Search size={17} />}
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setNotice(""); setError(""); }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closePicker();
                    if (event.key === "Enter" && websiteFromQuery(query)) {
                      event.preventDefault();
                      void discoverWebsiteIcon();
                    }
                  }}
                  placeholder="搜索图标或输入官网，例如 Netflix、微信、dmit.io"
                />
              </label>
            ) : (
              <label className="monogram-input-head">
                <Type size={17} />
                <input
                  ref={monogramRef}
                  value={monogramDraft}
                  onChange={(event) => {
                    if (monogramComposingRef.current) setMonogramDraft(event.target.value);
                    else updateMonogramDraft(event.target.value);
                  }}
                  onCompositionStart={() => { monogramComposingRef.current = true; }}
                  onCompositionEnd={(event) => {
                    monogramComposingRef.current = false;
                    updateMonogramDraft(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !creatingMonogram) returnToBrowse();
                    if (event.key === "Enter" && !event.nativeEvent.isComposing && monogram.choice && !creatingMonogram) {
                      event.preventDefault();
                      void confirmMonogram();
                    }
                  }}
                  aria-label="字母图标文字，最多 5 个字符"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  enterKeyHint="done"
                  maxLength={32}
                  disabled={creatingMonogram}
                  aria-invalid={Boolean(monogram.error)}
                  aria-describedby="monogram-help"
                  placeholder="输入 1–5 个字符，例如 VMISS"
                />
                <span className={monogram.error ? "invalid" : ""} aria-live="polite">{monogram.count}/{MAX_MONOGRAM_GRAPHEMES}</span>
              </label>
            )}
            {mode === "browse" && websiteQuery && <button type="button" className="brand-discover-button" onClick={discoverWebsiteIcon} disabled={discovering}>{discovering ? "正在获取…" : "获取官网图标"}</button>}
            <button type="button" className="brand-search-close" disabled={mode === "monogram" && creatingMonogram} onClick={closePicker} aria-label="关闭图标搜索"><X size={17} /></button>
          </div>
          <div className="brand-result-meta" aria-live="polite">
            <span>{mode === "monogram" ? "自定义字母图标" : websiteQuery ? "已识别官网地址" : loading ? "正在搜索…" : query ? `${results.length} 个结果` : "精选图标"}</span>
            {mode === "browse" ? <button type="button" className="monogram-entry" onClick={openMonogramBuilder}><Type size={13} />字母图标</button> : <button type="button" className="monogram-back" disabled={creatingMonogram} onClick={returnToBrowse}>返回图标搜索</button>}
          </div>
          {mode === "browse" ? (
            <>
              <div className="brand-results" aria-label="图标搜索结果">
                {results.map((option) => (
                  <button
                    type="button"
                    aria-pressed={choiceKey(candidate) === choiceKey(option)}
                    className={choiceKey(candidate) === choiceKey(option) ? "selected" : ""}
                    key={choiceKey(option)}
                    onClick={() => {
                      setCandidate(option);
                      setCandidateWebsite(option.source === "website" && option.domain ? `https://${option.domain}/` : null);
                      setNotice("");
                      setError("");
                    }}
                  >
                    <BrandIcon iconId={option.iconId} iconKey={option.iconKey} accent={option.accent} size={38} />
                    <span title={option.title}><strong>{option.title}</strong><small>{sourceLabel(option)}</small></span>
                    {choiceKey(candidate) === choiceKey(option) && <i><Check size={11} /></i>}
                  </button>
                ))}
                {!websiteQuery && !loading && !error && results.length === 0 && <p className="brand-empty">没有匹配图标，也可直接输入服务官网。</p>}
              </div>
              {notice && <p className="brand-notice">{notice}</p>}
              {error && (
                <div className="brand-error-recovery">
                  <p className="form-error" role="alert">{error}</p>
                  {websiteQuery && <button type="button" onClick={openMonogramBuilder}><Type size={14} />创建字母图标</button>}
                </div>
              )}
              <div className="brand-confirm">
                <div><BrandIcon iconId={candidate.iconId} iconKey={candidate.iconKey} accent={candidate.accent} size={42} /><span><small>将使用</small><strong>{candidate.title}</strong></span></div>
                <span className="brand-confirm-actions"><button type="button" onClick={closePicker}>取消</button><button type="button" className="save-button" disabled={!candidate.iconId} onClick={() => { onChange(candidate); if (candidateWebsite) onWebsiteChange(candidateWebsite); setOpen(false); setQuery(""); setCandidateWebsite(null); setNotice(""); }}>使用此图标</button></span>
              </div>
            </>
          ) : (
            <>
              <div className="monogram-builder" aria-busy={creatingMonogram}>
                <BrandIcon iconId={monogram.choice?.iconId ?? null} iconKey={monogram.choice?.iconKey ?? "fallback"} accent={monogram.choice?.accent ?? "blue"} size={64} />
                <div>
                  <strong>{monogram.choice?.title || "输入你的字母"}</strong>
                  <p id="monogram-help" className={monogram.error ? "error" : ""}>{monogram.error || "支持中文、英文字母和数字，最多 5 个字符。"}</p>
                  <div className="monogram-color-field">
                    <span><Palette size={13} />颜色</span>
                    <div className="monogram-color-options" role="group" aria-label="字母图标颜色">
                      {MONOGRAM_COLORS.map((color) => (
                        <button
                          type="button"
                          key={color.value}
                          className={monogramColor === color.value ? "selected" : ""}
                          style={{ backgroundColor: `#${color.value}` }}
                          aria-label={color.label}
                          aria-pressed={monogramColor === color.value}
                          title={color.label}
                          onClick={() => { setMonogramColor(color.value); setMonogramColorTouched(true); setError(""); }}
                        >{monogramColor === color.value && <Check size={12} />}</button>
                      ))}
                      <label className={`monogram-custom-color${monogramColorIsCustom ? " selected" : ""}`} title="自定义颜色">
                        <input
                          type="color"
                          value={`#${monogramColor}`}
                          aria-label="自定义字母图标颜色"
                          onChange={(event) => { setMonogramColor(normalizedMonogramColor(event.target.value)); setMonogramColorTouched(true); setError(""); }}
                        />
                        <span style={monogramColorIsCustom ? { background: `#${monogramColor}` } : undefined}>{monogramColorIsCustom ? <Check size={12} /> : <Palette size={12} />}</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="brand-confirm">
                <div><BrandIcon iconId={monogram.choice?.iconId ?? null} iconKey={monogram.choice?.iconKey ?? "fallback"} accent={monogram.choice?.accent ?? "blue"} size={42} /><span><small>将使用</small><strong>{monogram.choice?.title || "字母图标"}</strong></span></div>
                <span className="brand-confirm-actions"><button type="button" disabled={creatingMonogram} onClick={closePicker}>取消</button><button type="button" className="save-button" disabled={!monogram.choice || creatingMonogram} onClick={() => void confirmMonogram()}>{creatingMonogram ? "正在创建…" : "使用此图标"}</button></span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ==UserScript==
// @name         Codex Quota Estimate
// @name:zh-CN   Codex 额度估算
// @namespace    https://github.com/Cailishy/codex-quota-estimate
// @version      0.1
// @description  Shows Codex quota windows on the ChatGPT Usage page and values per-model token usage at official rates to estimate what the weekly allowance is worth in USD.
// @description:zh-CN  在 ChatGPT 用量页面查看 Codex 额度窗口，按官方费率把各模型 Token 用量折算成美元，估算周额度价值。
// @author       Cailishy
// @license      MIT
// @homepageURL  https://github.com/Cailishy/codex-quota-estimate
// @supportURL   https://github.com/Cailishy/codex-quota-estimate/issues
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // ───────────────────────── 费率 ─────────────────────────
  // 官方 Codex 费率表 (https://learn.chatgpt.com/docs/pricing) 的 credits × $0.04，
  // 与 OpenAI API 标准价一致 (https://developers.openai.com/api/docs/pricing)。
  // 每行：[模型名前缀, 输入, 缓存输入, 输出]，单位为美元 / 百万 Token；匹配时取最长前缀。
  const PRICE_ROWS = [
    ["gpt-6-astra", 10, 1, 50],
    ["gpt-6.1-sol", 2, 0.1, 10],
    ["gpt-6-sol", 2, 0.2, 10],
    ["gpt-6-luna", 0.1, 0.01, 0.5],
    ["gpt-5.6-sol", 4, 0.4, 20],
    ["gpt-5.6-terra", 2, 0.2, 12],
    ["gpt-5.6-luna", 0.2, 0.02, 1.2],
    ["gpt-5.5", 5, 0.5, 30],
    ["gpt-rosalind-research", 5, 0.5, 25],
    ["daybreak-blue", 4, 0.4, 20],
    ["daybreak-red", 12.5, 1.25, 75],
  ];
  const PRICES_CHECKED = "2026-10-11";
  // 1 credit 对应的美元（官方 credit 单价，与 API 价格等价）
  const USD_PER_CREDIT = 0.04;
  // 不计入周额度、也不提示缺少定价的模型（前缀匹配）。
  // 代码审查有独立的限额（usage 接口中的 code_review_rate_limit），不占用周额度。
  const EXCLUDED_MODELS = ["codex-auto-review"];
  // 速度倍率：与官方返回的 credits 一致（实测 Fast 模式的 credits 正好是标准速度的 2 倍，
  // 对应官方费率表中 purchased credits 一档：Fast 2×、Ultrafast 6×）
  const SPEED_FACTOR = { standard: 1, fast: 2, ultrafast: 6 };
  // 账号类型分组（按 plan_type 前缀匹配），两类账号的接口数据结构不同：
  //   personal：每日 totals 带官方 credits，模型明细只有轮数 → 按 credits 计算
  //   workspace：credits 不含套餐内用量（为 0 或只有超额部分），模型明细带 Token → 按 Token × 费率计算
  const PLAN_GROUPS = {
    personal: ["plus", "pro", "go", "free"],
    workspace: ["team", "business", "enterprise", "edu"],
  };
  const PLAN_LABELS = { personal: "个人套餐", workspace: "工作区套餐" };
  // 使用来源归并为几类（兼容 CODEX_DESKTOP_APP 与 desktop_app 两种写法），未列出的一律归入「其他」
  const SOURCE_GROUPS = {
    Desktop: ["desktop_app", "work_desktop"],
    CLI: ["cli", "exec", "service_exec", "sdk"],
    Plugin: ["vscode", "jetbrains"],
    Web: ["web", "work_web", "mobile", "work_mobile"],
  };
  const sourceLabel = (id) => {
    const k = String(id || "").toLowerCase().replace(/^codex_/, "");
    if (/^ide/.test(k)) return "Plugin";
    for (const [label, keys] of Object.entries(SOURCE_GROUPS)) if (keys.includes(k)) return label;
    return "其他";
  };
  const LOOKBACK_DAYS = 30;
  const LOW_PERCENT = 5;

  // ───────────────────────── 工具 ─────────────────────────
  const toNum = (x) => (Number.isFinite(+x) ? +x : 0);
  const DAY_MS = 864e5;
  // sv-SE 区域格式恰好是 YYYY-MM-DD，且使用本地时区
  const dayKey = (ms) => new Date(ms).toLocaleDateString("sv-SE");

  const fmt = {
    usd: (v) =>
      v === 0 ? "$0"
      : v < 0.01 ? "<$0.01"
      : `$${v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")}`,
    tok: (v) =>
      v >= 1e9 ? `${(v / 1e9).toFixed(2)}B`
      : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M`
      : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K`
      : String(Math.round(v)),
    when: (sec) =>
      new Date(sec * 1000).toLocaleString("zh-CN", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }),
  };

  const countTokens = (r = {}) =>
    toNum(r.uncached_text_input_tokens) + toNum(r.cached_text_input_tokens) + toNum(r.text_output_tokens) ||
    toNum(r.text_total_tokens);

  // ───────────────────────── 计价 ─────────────────────────
  const normalizeModel = (model) => String(model || "").toLowerCase().replace(/\s+/g, "-");

  const isExcluded = (model) => EXCLUDED_MODELS.some((p) => normalizeModel(model).startsWith(p));

  function lookupPrice(model) {
    const id = normalizeModel(model);
    let best = null;
    for (const row of PRICE_ROWS) {
      if (id.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row;
    }
    return best;
  }

  function priceEntry(e, usdPerCredit) {
    const speed = String(e.speed || "standard").toLowerCase();
    const row = lookupPrice(e.model);
    const factor = SPEED_FACTOR[speed];
    const tokens = countTokens(e);
    const turns = toNum(e.turns);
    const excluded = isExcluded(e.model);
    if (excluded) return { speed, tokens, turns, usd: 0, priced: false, excluded: true };
    // 官方已经算好 credits 时直接使用
    if (toNum(e.credits) > 0) return { speed, tokens, turns, usd: toNum(e.credits) * usdPerCredit, priced: true };
    // 部分账号（如 Plus）的模型明细只有轮数，没有 Token 和 credits
    if (tokens === 0) return { speed, tokens, turns, usd: 0, priced: false, noData: true };
    if (!row || factor === undefined) return { speed, tokens, turns, usd: 0, priced: false };
    const split =
      toNum(e.uncached_text_input_tokens) + toNum(e.cached_text_input_tokens) + toNum(e.text_output_tokens);
    // 有 Token 但没有输入 / 缓存 / 输出的拆分时无法计价，不能当成 $0
    if (split === 0) return { speed, tokens, turns, usd: 0, priced: false, noSplit: true };
    const [, pIn, pCached, pOut] = row;
    const usd =
      ((toNum(e.uncached_text_input_tokens) * pIn +
        toNum(e.cached_text_input_tokens) * pCached +
        toNum(e.text_output_tokens) * pOut) * factor) / 1e6;
    return { speed, tokens, turns, usd, priced: true };
  }

  // 按窗口长度识别：一天以内为 5 小时窗口，更长的为周窗口（部分套餐没有 5 小时限制）
  function readWindows(rateLimit) {
    const list = [rateLimit?.primary_window, rateLimit?.secondary_window]
      .filter(Boolean)
      .sort((a, b) => toNum(a.limit_window_seconds) - toNum(b.limit_window_seconds));
    const isShort = (w) => toNum(w.limit_window_seconds) < 86400;
    return {
      session: list.find(isShort) || null,
      weekly: [...list].reverse().find((w) => !isShort(w)) || null,
    };
  }

  function planGroupOf(planType) {
    const id = String(planType || "").toLowerCase();
    for (const [group, prefixes] of Object.entries(PLAN_GROUPS)) {
      if (prefixes.some((p) => id.startsWith(p))) return group;
    }
    return null;
  }

  // 计算一天的金额，返回 { usd, source, missing: [{ name, tokens }] }；source 为 credits / tokens / null
  function valueDay(t, entries, dayTokens, group, usdPerCredit) {
    const credits = toNum(t.credits);
    const entryTokens = entries.reduce((s, e) => s + e.tokens, 0);
    const byCredits = () => ({ usd: credits * usdPerCredit, source: "credits", missing: [] });
    const byTokens = () => ({
      usd: entries.reduce((s, e) => s + e.usd, 0),
      source: "tokens",
      missing: entries
        .filter((e) => !e.priced && !e.excluded)
        .map((e) => ({
          name: (e.speed === "standard" ? e.model : `${e.model} (${e.speed})`) + (e.noSplit ? "（缺少输入/输出拆分）" : ""),
          tokens: e.tokens,
        })),
    });
    const unpriced = (name) =>
      dayTokens > 0 ? { usd: 0, source: null, missing: [{ name, tokens: dayTokens }] } : { usd: 0, source: null, missing: [] };

    if (group === "personal") {
      // 个人套餐只认官方 credits：模型明细既没有 Token，也不完整（不计轮数的后台调用不会列出），
      // 无法据此估算金额
      if (credits > 0) return byCredits();
      return unpriced("(当天缺少 credits)");
    }

    if (group === "workspace") {
      if (entryTokens > 0) return byTokens();
      // 模型明细没有 Token 时，只能退回 credits（可能只含超额部分）
      if (credits > 0) return byCredits();
      return unpriced("(无模型 Token 明细)");
    }

    // 未知账号类型：按数据自动判断
    if (credits > 0) return byCredits();
    if (entryTokens > 0) return byTokens();
    return unpriced("(无模型明细)");
  }

  function buildEstimate(usage, days, dailyError, usdPerCredit = USD_PER_CREDIT, sessionPlan = null, breakdown = []) {
    const planType = String(usage?.plan_type || sessionPlan || "").toLowerCase() || null;
    const group = planGroupOf(planType);
    const { session, weekly } = readWindows(usage?.rate_limit);
    const cycleStart = weekly
      ? dayKey((toNum(weekly.reset_at) - toNum(weekly.limit_window_seconds)) * 1000)
      : null;
    const cycleEnd = weekly ? dayKey(toNum(weekly.reset_at) * 1000) : null;

    const rows = days
      .map((d) => {
        const t = d.totals || {};
        const entries = (d.models || []).map((m) => ({ model: String(m.model), ...priceEntry(m, usdPerCredit) }));
        const dayTokens = countTokens(t) || entries.reduce((s, e) => s + e.tokens, 0);
        const credits = toNum(t.credits);
        const v = valueDay(t, entries, dayTokens, group, usdPerCredit);
        // 客户端明细同时带 Token 和官方 credits（credits 为 0 的账号只能看 Token）
        const clients = (d.clients || []).map((c) => ({
          client: String(c.client_id || "未知"),
          turns: toNum(c.turns),
          tokens: countTokens(c),
          credits: toNum(c.credits),
        }));
        return {
          clients,
          date: String(d.date),
          inCycle: !cycleStart || d.date >= cycleStart,
          tokens: dayTokens,
          turns: toNum(t.turns),
          users: toNum(t.users),
          credits,
          source: v.source,
          usd: v.usd,
          entries,
          partial: v.missing.length > 0,
          missingNames: v.missing.map((m) => m.name),
          missingTokens: v.missing.reduce((s, m) => s + m.tokens, 0),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const total = (list) =>
      list.reduce(
        (acc, r) => {
          acc.usd += r.usd;
          acc.tokens += r.tokens;
          acc.turns += r.turns;
          acc.peakUsers = Math.max(acc.peakUsers, r.users);
          acc.missingTokens += r.missingTokens;
          r.missingNames.forEach((name) => acc.missing.add(name));
          return acc;
        },
        { usd: 0, tokens: 0, turns: 0, peakUsers: 0, missingTokens: 0, missing: new Set() },
      );

    const cycleRows = rows.filter((r) => r.inCycle);
    const cycle = total(cycleRows);
    const earlier = total(rows.filter((r) => !r.inCycle));

    const byModel = new Map();
    for (const r of cycleRows) {
      for (const e of r.entries) {
        const key = `${e.model}\u0000${e.speed}`;
        const m = byModel.get(key) ||
          { model: e.model, speed: e.speed, tokens: 0, turns: 0, usd: 0, priced: true, noData: true, excluded: !!e.excluded };
        m.tokens += e.tokens;
        m.turns += e.turns;
        m.usd += e.usd;
        m.noData = m.noData && !!e.noData;
        m.priced = m.priced && (e.priced || !!e.noData);
        byModel.set(key, m);
      }
    }
    const sources = new Set(rows.map((r) => r.source).filter(Boolean));

    const byClient = new Map();
    for (const r of cycleRows) {
      for (const c of r.clients) {
        const key = sourceLabel(c.client);
        const m = byClient.get(key) || { client: key, turns: 0, tokens: 0, credits: 0, usd: 0 };
        m.turns += c.turns;
        m.tokens += c.tokens;
        m.credits += c.credits;
        byClient.set(key, m);
      }
    }

    // daily-token-usage-breakdown 给出每天各模型、各来源的相对占比（官方页面「按模型」视图的数据）。
    // 数值单位是百分比且按区间内最大的一天归一化，因此只取当天内的比例，再乘以当天金额。
    let models;
    let fromBreakdown = false;
    const rowByDate = new Map(cycleRows.map((r) => [r.date, r]));
    const bdModels = new Map();
    for (const day of breakdown) {
      const row = rowByDate.get(String(day.date));
      if (!row || !(row.usd > 0)) continue;
      const ms = (day.models || []).filter(
        (m) => toNum(m.credits) > 0 && !(group === "workspace" && isExcluded(m.model)),
      );
      const mTotal = ms.reduce((t, m) => t + toNum(m.credits), 0);
      for (const m of ms) {
        const speed = String(m.speed || "standard").toLowerCase();
        const key = `${m.model}\u0000${speed}`;
        const cur = bdModels.get(key) || { model: String(m.model), speed, usd: 0 };
        cur.usd += (row.usd * toNum(m.credits)) / mTotal;
        bdModels.set(key, cur);
      }
      const ss = Object.entries(day.product_surface_usage_values || {}).filter(([, v]) => toNum(v) > 0);
      const sTotal = ss.reduce((t, [, v]) => t + toNum(v), 0);
      for (const [k, v] of ss) {
        const key = sourceLabel(k);
        const cur = byClient.get(key) || { client: key, turns: 0, tokens: 0, credits: 0, usd: 0 };
        cur.fromBreakdown = true;
        cur.usd += (row.usd * toNum(v)) / sTotal;
        byClient.set(key, cur);
      }
    }
    if (bdModels.size) {
      fromBreakdown = true;
      // 轮数和 Token 仍取自每日用量接口（Plus 账号只有轮数）
      for (const [key, m] of bdModels) {
        const c = byModel.get(key);
        Object.assign(m, { turns: c?.turns || 0, tokens: c?.tokens || 0, priced: true, noData: false, excluded: false });
      }
      for (const [key, c] of byModel) {
        if (!bdModels.has(key) && (c.turns > 0 || c.tokens > 0)) bdModels.set(key, { ...c, usd: 0, noData: true });
      }
      models = [...bdModels.values()];
    } else {
      models = [...byModel.values()];
    }
    models.sort((a, b) => b.usd - a.usd || b.tokens - a.tokens || b.turns - a.turns);

    const clients = [...byClient.values()]
      .filter((c) => c.tokens > 0 || c.credits > 0 || c.turns > 0 || c.usd > 0)
      .map((c) => ({
        ...c,
        usd: c.fromBreakdown ? c.usd : c.credits > 0 ? c.credits * usdPerCredit : null,
      }))
      .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.tokens - a.tokens);

    const weeklyPct = weekly ? toNum(weekly.used_percent) : 0;
    // 没有可计价的用量时无法推算，避免显示误导性的 $0
    const allowanceUsd = weeklyPct > 0 && cycle.usd > 0 ? (cycle.usd * 100) / weeklyPct : null;
    const remainingUsd = allowanceUsd == null ? null : Math.max(0, allowanceUsd - cycle.usd);

    const notes = [];
    if (dailyError) notes.push(dailyError);
    if (!weekly) notes.push("接口没有返回周窗口，无法估算周额度。");
    // 每日用量统计有延迟：周期刚开始时，百分比已经变了，但还没有对应的用量数据
    if (!dailyError && weekly && weeklyPct > 0 && cycle.tokens === 0)
      notes.push(
        `本周期从 ${fmt.when(toNum(weekly.reset_at) - toNum(weekly.limit_window_seconds))} 开始，周额度已用 ${weeklyPct}%，` +
          "但每日用量统计还没有本周期的数据（统计有延迟），暂时无法估算金额，请稍后刷新。",
      );
    if (weeklyPct > 0 && weeklyPct < LOW_PERCENT)
      notes.push(`周窗口只用了 ${weeklyPct}%，接口又只给整数百分比，估值可能偏差数倍。`);
    if (group !== "personal" && cycle.peakUsers > 1)
      notes.push(`用量数据覆盖整个工作区（最多 ${cycle.peakUsers} 人），而百分比只反映你本人的额度，估值会偏高。`);
    if (cycle.missing.size)
      notes.push(
        `部分用量未计入金额（估值可能偏低）：${[...cycle.missing].join("、")}，共 ${fmt.tok(cycle.missingTokens)} Token。`,
      );

    // 接口按整天统计，周期起始日的用量里混有重置之前的部分
    const firstDay = cycleStart && rows.find((r) => r.date === cycleStart);
    if (firstDay && firstDay.usd > 0)
      notes.push(`周期起始日 ${cycleStart} 按整天统计，其中 ${fmt.usd(firstDay.usd)} 可能有一部分发生在重置之前，估值可能偏高。`);

    return {
      session, weekly, cycleStart, cycleEnd, rows, cycle, earlier, models, allowanceUsd, remainingUsd, notes, sources,
      planType, group, clients, fromBreakdown,
      hasDaily: !dailyError,
    };
  }

  // ───────────────────────── 数据 ─────────────────────────
  const readCookie = (name) =>
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);

  // 同一个 ChatGPT 账号可能属于多个工作区（个人 + 多个 Team）。网页通过 ChatGPT-Account-Id
  // 请求头指定当前工作区；不带这个头时，接口可能返回别的工作区的数据或直接报错。
  async function getAuth() {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    let session = null;
    try {
      session = await res.json();
    } catch {
      /* 未登录时可能返回 HTML */
    }
    if (!res.ok || !session?.accessToken) throw new Error("没有读取到登录状态，请先登录 ChatGPT");
    const cookieAccount = decodeURIComponent(readCookie("_account") || "");
    const accountId = /^[0-9a-f-]{36}$/i.test(cookieAccount) ? cookieAccount : session.account?.id || null;
    return { token: session.accessToken, accountId, planType: session.account?.planType || null };
  }

  async function getJson(url, auth) {
    const headers = { Authorization: `Bearer ${auth.token}` };
    if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
    const res = await fetch(url, { credentials: "same-origin", headers });
    if (!res.ok) {
      const err = new Error(`接口 ${url.split("?")[0]} 返回 HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function loadEstimate() {
    const auth = await getAuth();
    const now = Date.now();
    const query = new URLSearchParams({
      start_date: dayKey(now - LOOKBACK_DAYS * DAY_MS),
      end_date: dayKey(now + DAY_MS),
      group_by: "day",
    });
    const [usage, daily, breakdown] = await Promise.allSettled([
      getJson("/backend-api/wham/usage", auth),
      getJson(`/backend-api/wham/analytics/daily-workspace-usage-counts?${query}`, auth),
      getJson(`/backend-api/wham/usage/daily-token-usage-breakdown?${query}`, auth),
    ]);
    // 额度百分比是必需的；每日用量读不到时（例如非管理员成员没有权限）仍显示额度窗口
    if (usage.status === "rejected") throw usage.reason;
    let dailyError = null;
    if (daily.status === "rejected") {
      const s = daily.reason?.status;
      dailyError =
        s === 401 || s === 403
          ? `当前账号无权读取工作区用量统计（HTTP ${s}，通常只有工作区管理员可以查看），只能显示额度百分比，无法计算金额。`
          : `读取每日用量失败（${daily.reason?.message || "未知错误"}），无法计算金额。`;
    }
    const days = daily.status === "fulfilled" && Array.isArray(daily.value?.data) ? daily.value.data : [];
    // balance_unit 标明 credits 字段的单位；若直接是美元则不再换算
    const usdPerCredit = /usd|dollar/i.test(String(daily.value?.balance_unit || "")) ? 1 : USD_PER_CREDIT;
    const bdDays = breakdown.status === "fulfilled" && Array.isArray(breakdown.value?.data) ? breakdown.value.data : [];
    return buildEstimate(usage.value, days, dailyError, usdPerCredit, auth.planType, bdDays);
  }

  // ───────────────────────── 视图 ─────────────────────────
  // 轻量 DOM 构造：文本一律作为文本节点插入，无需手动转义
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const CSS = `
    :host {
      all: initial;
      --bg: #ffffff; --fg: #1f2328; --sub: #656d76; --line: #d8dee4; --soft: #f6f8fa;
      --brand: #0f7b5f; --brand-soft: #e3f4ee; --warn-bg: #fff4d6; --warn-fg: #7a5200; --err: #d1242f;
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    :host([data-theme="dark"]) {
      --bg: #1e1f22; --fg: #e6e6e6; --sub: #a0a4a8; --line: #34373c; --soft: #26282c;
      --brand: #3ccf9e; --brand-soft: #173a2f; --warn-bg: #3b3014; --warn-fg: #f2cf75; --err: #ff7b72;
    }
    [hidden] { display: none !important; }
    button { font: inherit; }
    .launcher {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; align-items: center; gap: 10px;
      padding: 10px 18px 10px 14px; border: 0; border-radius: 16px;
      background: linear-gradient(135deg, #10a37f, #0b7a8f); color: #fff;
      font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: 0 6px 20px rgba(16, 163, 127, .35);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(16, 163, 127, .45); }
    .launcher .emoji { font-size: 24px; line-height: 1; }
    .launcher .text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.3; }
    .launcher .sub { font-size: 11px; font-weight: 500; opacity: .9; }
    .drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483001;
      width: min(440px, 100vw); display: flex; flex-direction: column; box-sizing: border-box;
      background: var(--bg); color: var(--fg); border-left: 1px solid var(--line);
      box-shadow: -8px 0 24px rgba(0, 0, 0, .18);
    }
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 15px;
    }
    .actions { display: flex; gap: 4px; }
    .icon {
      width: 30px; height: 30px; border: 0; border-radius: 6px;
      background: transparent; color: var(--sub); font-size: 16px; cursor: pointer;
    }
    .icon:hover { background: var(--soft); color: var(--fg); }
    .body { flex: 1; overflow-y: auto; padding: 12px 16px 24px; }
    section { margin-bottom: 18px; }
    h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
    h3 small { font-weight: 400; margin-left: 4px; }
    .meter { margin-bottom: 12px; }
    .meter-top { display: flex; justify-content: space-between; }
    .bar { height: 8px; margin: 4px 0 2px; border-radius: 4px; background: var(--soft); overflow: hidden; }
    .bar i { display: block; height: 100%; border-radius: 4px; background: var(--brand); }
    .bar i.mid { background: #e3a008; }
    .bar i.low { background: var(--err); }
    small { color: var(--sub); font-size: 11px; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat {
      display: flex; flex-direction: column; padding: 10px 12px;
      border: 1px solid var(--line); border-radius: 8px; background: var(--soft);
    }
    .stat span { color: var(--sub); font-size: 12px; }
    .stat b { font-size: 17px; font-variant-numeric: tabular-nums; }
    .stat.accent { background: var(--brand-soft); border-color: var(--brand); }
    .stat.accent b { color: var(--brand); }
    .notes {
      margin: 0 0 18px; padding: 8px 12px; list-style: none; border-radius: 8px;
      background: var(--warn-bg); color: var(--warn-fg); font-size: 12px;
    }
    .notes li + li { margin-top: 4px; }
    .scroll { max-height: 260px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
    th, td { padding: 6px 8px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); }
    th:first-child, td:first-child { text-align: left; }
    thead th { position: sticky; top: 0; background: var(--soft); color: var(--sub); font-weight: 600; }
    tfoot td { font-weight: 600; background: var(--soft); }
    tr.divider td { text-align: center; color: var(--sub); font-size: 11px; }
    .status { color: var(--sub); }
    .status.error { color: var(--err); }
    .hint { margin: 6px 0 0; color: var(--sub); font-size: 11px; }
    .plan {
      display: flex; align-items: baseline; gap: 8px; margin: 0 0 14px; padding: 8px 12px;
      border-radius: 8px; background: var(--soft); font-weight: 600;
    }
  `;

  const thead = (cols) => h("thead", null, h("tr", null, cols.map((c) => h("th", null, c))));
  const simpleTable = (cols, rows) =>
    h("div", { class: "scroll" },
      h("table", null, thead(cols), h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, c)))))));

  const leftPct = (w) => 100 - Math.min(100, Math.max(0, toNum(w.used_percent)));
  const levelEmoji = (left) => (left > 50 ? "🟢" : left > 20 ? "🟡" : "🔴");

  function meter(label, w) {
    if (!w) {
      return h("div", { class: "meter" },
        h("div", { class: "meter-top" }, h("span", null, label), h("b", null, "♾️ 无此限制")));
    }
    const left = leftPct(w);
    return h("div", { class: "meter" },
      h("div", { class: "meter-top" }, h("span", null, label), h("b", null, `${levelEmoji(left)} 剩余 ${left}%`)),
      h("div", { class: "bar" }, h("i", { class: left > 50 ? "" : left > 20 ? "mid" : "low", style: `width:${left}%` })),
      h("small", null, `已用 ${100 - left}% · 🔄 ${fmt.when(w.reset_at)} 重置`));
  }

  const stat = (label, value, hint, accent) =>
    h("div", { class: accent ? "stat accent" : "stat" }, h("span", null, label), h("b", null, value), hint && h("small", null, hint));

  function renderEstimate(L) {
    const period = L.cycleStart ? `${L.cycleStart} – ${L.cycleEnd}` : null;
    const title = (text, extra) => h("h3", null, text, extra && h("small", null, extra));

    const planName = L.planType ? L.planType.charAt(0).toUpperCase() + L.planType.slice(1) : "未知";
    const out = [
      h("p", { class: "plan" },
        `📋 ${planName} 账号`,
        L.group && h("small", null, PLAN_LABELS[L.group])),
      h("section", null, title("⏱️ 额度窗口"), meter("⚡ 5 小时", L.session), meter("🗓️ 每周", L.weekly)),
      h("section", null,
        title("📅 本周期", period),
        h("div", { class: "stats" },
          stat("💰 剩余额度 · 估算", L.remainingUsd == null ? "—" : fmt.usd(L.remainingUsd), "周额度估值 − 已消耗", true),
          stat("📦 周额度估值", L.allowanceUsd == null ? "—" : fmt.usd(L.allowanceUsd),
            L.hasDaily ? `本周期已消耗 ${fmt.usd(L.cycle.usd)}` : null),
          stat("🔤 Token", L.hasDaily ? fmt.tok(L.cycle.tokens) : "—"),
          stat("💬 对话轮数", L.hasDaily ? L.cycle.turns.toLocaleString() : "—"))),
    ];

    if (L.notes.length) out.push(h("ul", { class: "notes" }, L.notes.map((t) => h("li", null, `⚠️ ${t}`))));
    if (!L.hasDaily) return out;

    // 模型构成始终显示；本周期还没有模型明细时（统计延迟）给出说明
    if (L.models.length) {
      const sum = L.models.reduce((s, m) => s + m.usd, 0) || 1;
      const allNoData = L.models.every((m) => m.noData || m.excluded);
      out.push(h("section", null, title("🧠 模型构成", period),
        simpleTable(["模型", "速度", "轮数", "Token", "金额", "占比"],
          L.models.map((m) => [
            m.model, m.speed, m.turns || "—",
            m.tokens > 0 ? fmt.tok(m.tokens) : "—",
            m.excluded ? "不计入" : m.noData ? "—" : m.priced ? fmt.usd(m.usd) : "未计入",
            m.priced && !m.noData ? `${((m.usd / sum) * 100).toFixed(1)}%` : "—",
          ])),
        !L.fromBreakdown && allNoData &&
          h("p", { class: "hint" }, "当前账号的模型明细只有轮数，没有 Token 和金额拆分，金额请看下方使用来源。")));
    } else {
      out.push(h("section", null, title("🧠 模型构成", period),
        h("p", { class: "status" }, "本周期暂时还没有模型明细（接口统计有延迟），请稍后刷新。")));
    }

    if (L.clients.length) {
      const sum = L.clients.reduce((s, c) => s + (c.usd ?? 0), 0);
      out.push(h("section", null, title("💻 使用来源", period),
        simpleTable(["来源", "轮数", "Token", "金额", "占比"],
          L.clients.map((c) => [
            c.client, c.turns || "—", c.tokens > 0 ? fmt.tok(c.tokens) : "—",
            c.usd == null ? "—" : fmt.usd(c.usd),
            c.usd == null || !sum ? "—" : `${((c.usd / sum) * 100).toFixed(1)}%`,
          ]))));
    }

    const inCycle = L.rows.filter((r) => r.inCycle);
    const before = L.rows.filter((r) => !r.inCycle);
    // 金额单元格悬停时显示按模型拆分的明细，便于核对
    const breakdown = (r) =>
      r.source === "credits"
        ? `官方 credits：${r.credits.toFixed(2)} → ${fmt.usd(r.usd)}`
        : r.entries.length
        ? r.entries
            .map((e) => `${e.model} (${e.speed})：${fmt.tok(e.tokens)} Token → ${
              e.excluded || !e.priced ? "未计入" : fmt.usd(e.usd)}`)
            .join("\n")
        : "无模型明细";
    const dayRow = (r) =>
      h("tr", null,
        h("td", null, r.date),
        h("td", null, fmt.tok(r.tokens)),
        h("td", { title: breakdown(r) }, fmt.usd(r.usd) + (r.partial ? "*" : "")),
        h("td", null, r.turns));
    const sumRow = (label, s) =>
      h("tr", null, [label, fmt.tok(s.tokens), fmt.usd(s.usd), s.turns].map((c) => h("td", null, c)));

    out.push(h("section", null, title("📊 每日明细", `最近 ${LOOKBACK_DAYS} 天`),
      h("div", { class: "scroll" },
        h("table", null,
          thead(["日期", "Token", "金额", "轮数"]),
          h("tbody", null,
            inCycle.map(dayRow),
            before.length > 0 &&
              h("tr", { class: "divider" },
                h("td", { colspan: "4" }, `周期开始前（${before[before.length - 1].date} – ${before[0].date}）`)),
            before.map(dayRow)),
          h("tfoot", null, sumRow("本周期", L.cycle), before.length > 0 && sumRow("此前", L.earlier)))),
      L.rows.some((r) => r.partial) && h("p", { class: "hint" }, "* 当天有部分用量未计入金额。")));

    out.push(h("p", { class: "hint" }, "💡 金额为 API 等价价格，仅供参考。"));
    return out;
  }

  // ───────────────────────── 挂载 ─────────────────────────
  const host = h("div", { id: "codex-quota-estimate" });
  const shadow = host.attachShadow({ mode: "open" });
  const body = h("div", { class: "body" });
  const drawer = h("aside", { class: "drawer", hidden: true },
    h("header", null,
      h("strong", null, "🧭 Codex 额度估算"),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "icon", title: "刷新", onclick: () => refresh() }, "↻"),
        h("button", { type: "button", class: "icon", title: "关闭 (Esc)", onclick: () => closeDrawer() }, "✕"))),
    body);
  const launcherSub = h("span", { class: "sub" }, "点击查看剩余额度");
  const launcher = h("button", { type: "button", class: "launcher", title: "查看 Codex 额度估算", onclick: () => openDrawer() },
    h("span", { class: "emoji" }, "🧭"),
    h("span", { class: "text" }, h("span", null, "Codex 额度估算"), launcherSub));
  shadow.append(h("style", null, CSS), launcher, drawer);

  function applyTheme() {
    const cls = document.documentElement.classList;
    const dark = cls.contains("dark") || (!cls.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);
    host.dataset.theme = dark ? "dark" : "light";
  }

  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    body.replaceChildren(h("p", { class: "status" }, "⏳ 正在读取用量…"));
    try {
      const est = await loadEstimate();
      body.replaceChildren(...renderEstimate(est));
      // 按钮上显示最近一次读取到的周剩余
      if (est.weekly) {
        const left = leftPct(est.weekly);
        launcherSub.textContent = `${levelEmoji(left)} 周剩余 ${left}%` +
          (est.remainingUsd == null ? "" : ` · 约 ${fmt.usd(est.remainingUsd)}`);
      }
    } catch (err) {
      body.replaceChildren(h("p", { class: "status error" }, `❌ 读取失败：${err.message}`));
    } finally {
      loading = false;
    }
  }

  function openDrawer() {
    applyTheme();
    drawer.hidden = false;
    refresh();
  }

  function closeDrawer() {
    drawer.hidden = true;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) closeDrawer();
  });

  // 用量页可能是 /settings/usage，也可能是任意页面上的 #settings/Usage 弹窗。
  // ChatGPT 是单页应用，路由变化不会重新执行脚本，因此定时检查路由，并在节点被页面移除时重新挂载。
  const onUsageRoute = () =>
    /^\/(settings\/usage|codex\/(cloud\/)?settings\/analytics)/i.test(location.pathname) ||
    /settings\/usage/i.test(location.hash);

  function syncRoute() {
    if (!document.body) return;
    if (!host.isConnected) document.body.append(host);
    const visible = onUsageRoute();
    launcher.hidden = !visible;
    if (!visible) closeDrawer();
  }

  syncRoute();
  setInterval(syncRoute, 1000);
})();

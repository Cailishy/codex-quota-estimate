# Codex Quota Estimate

English | [中文](README.md)

![version](https://img.shields.io/badge/version-v0.1-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%7C%20Violentmonkey%20%7C%20ScriptCat-orange)

A userscript for ChatGPT's **Usage page**. It shows your Codex quota windows, converts each model's token usage to USD at OpenAI's official rates, and estimates how much of this week's allowance is left, in USD.

The official page only tells you "37% of the weekly allowance used". This script goes further and answers:

- About how much is that 37% worth?
- About how much is the whole week's allowance worth in USD, and how much is left?
- Which models and which clients (desktop app, CLI, IDE plugins, web) is it mostly going to?

> ⚠️ This is **not** an official OpenAI tool and is not affiliated with OpenAI. It relies on undocumented internal endpoints used by the ChatGPT web app, which OpenAI may change at any time and break this script. The estimates are for reference only; see [Limitations](#limitations-please-read).

The UI is in Chinese.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Reading the panel](#reading-the-panel)
- [How it calculates](#how-it-calculates)
- [Limitations](#limitations-please-read)
- [Privacy and security](#privacy-and-security)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Feedback and contributing](#feedback-and-contributing)
- [Acknowledgements](#acknowledgements)

## Features

- **Quota windows**: progress bars showing the remaining share of the 5-hour and weekly windows, with reset times in your local time. Plans without a 5-hour limit show "无此限制" (no such limit).
- **Current cycle overview**: estimated remaining allowance (USD), estimated weekly allowance value, amount spent this cycle, token count and number of turns.
- **Model breakdown**: turns, tokens, cost and share for each model and speed tier in the current cycle. On Plus / Pro accounts the per-model rows only have turn counts; when the current cycle has no per-model data yet, the panel says so.
- **Usage sources**: turns, tokens, cost and share for each source in the current cycle, grouped into:
  - Desktop: desktop app, Work desktop
  - CLI: including `codex exec`, service_exec and the SDK
  - Plugin: VS Code, JetBrains and other IDE plugins
  - Web: web and mobile
  - Other: integrations such as Slack and GitHub

  On Plus / Pro accounts this is where you see cost split by official credits.
- **Daily details**: tokens, cost and turns for each of the last 30 days. A divider row separates the current cycle from earlier days, and each part has its own totals. Hover over an amount to see the per-model breakdown.
- **Reliability warnings**: shown when:
  - the weekly percentage is too low;
  - the data covers a whole workspace;
  - a model is missing from the price table.
- **Multiple workspaces**: automatically uses the workspace you are currently in (personal or a Team); refresh after switching Teams.
- **Graceful fallback without permission**: if your account cannot read workspace usage statistics (usually admin-only), the quota percentages are still shown, without costs.
- **Bottom-right button**: after one load, the button shows the weekly remaining percentage and the estimated remaining amount.
- **Interface**:
  - side drawer that uses emoji and colors to show how much is left (🟢 plenty / 🟡 moderate / 🔴 low);
  - isolated from the page styles with Shadow DOM, and follows ChatGPT's dark / light theme;
  - can be refreshed at any time; press `Esc` to close.

## Installation

### 1. Install a userscript manager

Pick one browser extension:

| Manager | Browsers |
|---|---|
| [Tampermonkey](https://www.tampermonkey.net/) | Chrome, Edge, Firefox, Safari |
| [Violentmonkey](https://violentmonkey.github.io/) | Chrome, Edge, Firefox |
| [ScriptCat](https://scriptcat.org/) | Chrome, Edge, Firefox |

> With the Manifest V3 version of Tampermonkey on Chrome / Edge, turn on "Allow User Scripts" on the extension's details page (or enable Developer mode), otherwise the script will not run.

### 2. Install this script

Use any one of these:

- **Greasy Fork**: search for "Codex Quota Estimate" on [Greasy Fork](https://greasyfork.org/) and click "Install this script". This is the recommended way, because it updates automatically.
- **GitHub**: open the [raw link to `codex-quota-estimate.user.js`](https://raw.githubusercontent.com/Cailishy/codex-quota-estimate/main/codex-quota-estimate.user.js), and your userscript manager will show its install page.
- **Manually**: create a new script in your userscript manager, paste in the full contents of [`codex-quota-estimate.user.js`](codex-quota-estimate.user.js), and save. A manually installed script does not update automatically.

### Updating and uninstalling

- **Updating**: if you installed from Greasy Fork or the raw link, your userscript manager checks for updates periodically. You can also click "Check for updates" in the manager.
- **Uninstalling**: delete the script from your userscript manager's list. The script stores no data in your browser, so nothing is left behind.

## Usage

1. Sign in to ChatGPT and open **Settings → Usage** (`https://chatgpt.com/settings/usage`).
2. Click the **🧭 Codex 额度估算** (Codex Quota Estimate) button in the bottom-right corner. A panel slides in from the right.
3. The panel's title bar has two buttons: ↻ reloads the data, and ✕ closes the panel (you can also press `Esc`).

**When the data updates:** the script does not load data in the background. It loads data only:

- when you open the panel;
- when you click ↻.

Each load recalculates the cycle from the reset time returned by the endpoint. If the panel stays open past the weekly reset time, click ↻ to switch to the new cycle. The same applies to the numbers on the bottom-right button: they show the result of the last load.

## Reading the panel

| Section | Contents |
|---|---|
| Top | Account type (personal plan / workspace plan) and the start and end dates of the current cycle |
| Quota windows | Remaining percentage and reset time for the 5-hour and weekly windows. Colors: 🟢 when more than 50% is left, 🟡 when more than 20% is left, 🔴 otherwise |
| Current cycle overview | Estimated remaining allowance, estimated weekly value, amount spent, tokens, turns |
| Warnings | Yellow notices explaining why this result may be inaccurate |
| Model breakdown / Usage sources | The current cycle's cost split by model and by source |
| Daily details | Day-by-day data for the last 30 days. Amounts marked with `*` are incomplete; see the [FAQ](#faq) |

## How it calculates

### Amount spent

The script first picks a calculation method from the account type (the `plan_type` returned by the endpoint), because the two kinds of accounts return differently shaped data:

| Account type | What the endpoint returns | Calculation |
|---|---|---|
| **Personal plans**: Plus, Pro (also Go, Free) | Daily totals include official `credits`; per-model rows only have turn counts | `credits × $0.04`. Days without credits are not counted and are marked with `*` |
| **Workspace plans**: Team (also Business, Enterprise, Edu) | `credits` excludes included usage (it is 0, or only the overage part); per-model rows include token counts | Each model's tokens × the official rate card (formula below). Falls back to credits only when the per-model rows have no tokens |
| Unrecognized types | — | Uses credits if present, otherwise tokens |

The top of the panel shows the account type. The grouping lives in `PLAN_GROUPS` at the top of the script. The placement of Go, Free, Business, Enterprise and Edu is inferred from the plan type and has not been verified with real data. If you use one of these plans, please let us know whether the results look right.

The token-based formula:

OpenAI's [Codex rate card](https://learn.chatgpt.com/docs/pricing) lists how many credits each model uses per million tokens. At 1 credit = $0.04, these match the [OpenAI API standard prices](https://developers.openai.com/api/docs/pricing) exactly, so the script uses the API USD prices directly:

```
cost = (uncached input × input price + cached input × cached price + output × output price) ÷ 1,000,000 × speed multiplier
```

Speed multipliers match the official credits: standard 1×, fast 2×, ultrafast 6×. Measured: official credits in Fast mode are exactly 2× the standard-speed amount.

### Estimated weekly allowance and remaining allowance

```
estimated weekly value = amount spent this cycle ÷ (weekly used percentage ÷ 100)
remaining allowance    = estimated weekly value − amount spent this cycle
```

**Example:** you have spent $12 this cycle, and 40% of the weekly window is used.

- Estimated weekly value = 12 ÷ 0.4 = $30
- Remaining allowance = 30 − 12 = $18

The cycle starts at the weekly window's `reset_at − limit_window_seconds`, split by local date.

### Data sources

The script only calls chatgpt.com's own endpoints:

| Endpoint | Purpose |
|---|---|
| `/api/auth/session` | Gets the access token and workspace ID for the current signed-in session |
| `/backend-api/wham/usage` | Used percentage and reset time for the 5-hour and weekly windows |
| `/backend-api/wham/analytics/daily-workspace-usage-counts` | Daily credits, tokens and turns (totals, per model, per client) |
| `/backend-api/wham/usage/daily-token-usage-breakdown` | Daily usage share per model and per source (the same data as the official Usage → Analytics → By model view), used to split costs in the model and source breakdowns |

## Limitations (please read)

1. **Workspace data is mixed in**: the daily usage endpoint returns data for the **whole workspace**, while the percentage reflects **your own** allowance. If other people in your workspace use Codex (for example on Team / Business plans), the estimate will be too high.
2. **Unconfirmed linear relationship**: "amount spent ÷ percentage = weekly allowance" is an inference. OpenAI does not publish the weekly allowance, and does not say whether the allowance is charged exactly at API prices.
3. **Whole percentages only**: the endpoint only returns whole percentages. When the weekly percentage is very low (for example 1%), the estimate can be off by several times.
4. **Non-token consumption is not counted**: if cloud task runtime or tool calls also count against the allowance, a token-based calculation misses that part.
5. **The cycle start day is counted as a whole day**: the endpoint totals usage per day, but the weekly allowance resets at a specific time. Usage on the cycle start day may include some from before the reset, which makes the estimate too high; the panel warns you when this applies.
6. **Prices need maintenance**: when OpenAI adds models or changes prices, `PRICE_ROWS` must be updated. Models without a price are not counted, and the panel warns you.

Treat the estimated weekly value as a rough guide, not as an allowance promised by OpenAI. The more you use in a week, the higher the weekly percentage and the more stable the estimate.

## Privacy and security

- The access token is **only used to call chatgpt.com's own endpoints**.
- All data is processed in your browser only. Nothing is **sent to any third party**, and nothing is written to local storage.
- Requests are made only when you open the panel or click ↻ (4 endpoints per load). There is no background polling.
- The script needs no special permissions (`@grant none`), and the code is not obfuscated or minified, so you can review it directly.

## Configuration

Edit the constants at the top of the script:

| Constant | Description |
|---|---|
| `PRICE_ROWS` | Prices per model. Each row is: model-name prefix, input, cached input, output (USD per 1M tokens). The longest matching prefix wins. |
| `EXCLUDED_MODELS` | Models that are not counted toward the weekly allowance and never trigger a missing-price warning. Includes `codex-auto-review` by default (code review has its own limit). |
| `PRICES_CHECKED` | Date the prices were last checked (for reference only). |
| `SPEED_FACTOR` | Speed multipliers. |
| `PLAN_GROUPS` | Account type grouping, which decides whether costs come from credits or tokens. |
| `LOOKBACK_DAYS` | How many days of history to load (default 30). |
| `LOW_PERCENT` | Warn about a large error when the weekly percentage is below this value (default 5). |

> If you edit the script directly, an automatic update from your userscript manager will overwrite your changes. If a price is simply out of date, please open an issue or PR so everyone gets the new price.

### Current prices (checked 2026-10-11)

| Model | Input $/1M | Cached input $/1M | Output $/1M |
|---|---|---|---|
| gpt-6-astra | 10.00 | 1.00 | 50.00 |
| gpt-6.1-sol | 2.00 | 0.10 | 10.00 |
| gpt-6-sol | 2.00 | 0.20 | 10.00 |
| gpt-6-luna | 0.10 | 0.01 | 0.50 |
| gpt-5.6-sol | 4.00 | 0.40 | 20.00 |
| gpt-5.6-terra | 2.00 | 0.20 | 12.00 |
| gpt-5.6-luna | 0.20 | 0.02 | 1.20 |
| gpt-5.5 | 5.00 | 0.50 | 30.00 |
| gpt-rosalind-research | 5.00 | 0.50 | 25.00 |
| daybreak-blue | 4.00 | 0.40 | 20.00 |
| daybreak-red | 12.50 | 1.25 | 75.00 |

## FAQ

**I can't see the button.**

The button only appears on the Usage page. Check that:

- the script is enabled;
- the address is one of `/settings/usage`, `/codex/settings/analytics` or `/codex/cloud/settings/analytics`, or contains `#settings/Usage`;
- if you use Tampermonkey on Chrome / Edge, "Allow User Scripts" is turned on.

**I get "没有读取到登录状态" (no sign-in found) or "读取失败：接口 … 返回 HTTP 401" (load failed: endpoint … returned HTTP 401).**

Your sign-in has expired. Reload the page or sign in to ChatGPT again.

**I get "当前账号无权读取工作区用量统计" (this account cannot read workspace usage statistics).**

You are a regular member of a workspace such as a Team, and the daily usage endpoint is only open to admins. You can still see the quota percentages, but not costs.

**I get "读取失败：接口 … 返回 HTTP 404" (load failed: endpoint … returned HTTP 404).**

OpenAI has changed an endpoint. Please open an issue.

**Some days have a `*` after the amount.**

That day includes a model without a price, or has no per-model breakdown, so that part is not counted.

**The weekly allowance just reset, but the panel's numbers didn't change.**

The panel does not refresh automatically. Click ↻.

**My estimate is very different from someone else's.**

The estimated weekly value depends on:

- the plan type;
- how much you have used this cycle (the lower the percentage, the larger the error);
- whether other people in your workspace are using Codex.

Large differences between accounts are normal. See [Limitations](#limitations-please-read).

**Could this get my account banned?**

When you open the panel, the script uses your own sign-in to call a few endpoints that the ChatGPT web app itself already calls, at about the same rate as reloading the Usage page by hand. Still, this is an unofficial tool; use it at your own risk.

## Feedback and contributing

- **Reporting problems**: please open an issue in [Issues](https://github.com/Cailishy/codex-quota-estimate/issues) and include:
  - your account type;
  - your browser and userscript manager versions;
  - the error or warning text shown in the panel;
  - any related errors in the browser console.

  **Do not post your access token, cookies or the full raw endpoint responses.**
- **Updating prices**: when OpenAI changes prices or adds models, PRs that update `PRICE_ROWS` and `PRICES_CHECKED` are welcome. Please include a link to the official source.
- **Verifying plan grouping**: if you use a Go, Free, Business, Enterprise or Edu plan, please let us know whether the calculation method is correct.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Acknowledgements

The idea behind this project comes from these authors' posts. Thank you:

- **BlueSkyXN**: [完全准确查询你的 GPT 订阅周限的方法](https://linux.do/t/topic/2137136) ("A fully accurate way to check your GPT subscription's weekly limit", LINUX DO), which first proposed estimating the weekly allowance from the daily usage endpoint and the official rate card, combined with the weekly used percentage.
- **Jun Zhao (yfzz)**: [Codex Quota Compass (Visual Edition)](https://linux.do/t/topic/2138324) (LINUX DO), which turned the idea into a visual userscript panel.

This project's code was written independently and does not use code from the works above.

## License

[MIT](LICENSE)

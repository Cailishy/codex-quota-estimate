# 更新日志 / Changelog

## v0.1

首个公开版本。

- 在 ChatGPT 用量页面右下角添加「Codex 额度估算」按钮和侧边面板。
- 显示 5 小时窗口和周窗口的剩余比例与重置时间。
- 按账号类型选择计算方式：个人套餐按官方 credits，工作区套餐按各模型 Token × 官方费率。
- 估算周额度估值和剩余额度（美元）。
- 按模型、速度档位和使用来源拆分本周期的用量与金额。
- 最近 30 天的每日明细，区分本周期和之前的日子。
- 周百分比过低、数据来自整个工作区、出现未定价模型时给出提示。
- 账号无权读取每日用量时，仍显示额度百分比。

First public release.

- Adds a "Codex 额度估算" button and side panel to the bottom-right of ChatGPT's Usage page.
- Shows the remaining share and reset time of the 5-hour and weekly windows.
- Picks the calculation method by account type: official credits for personal plans, per-model tokens × official rates for workspace plans.
- Estimates the weekly allowance value and the remaining allowance in USD.
- Splits the current cycle's usage and cost by model, speed tier and usage source.
- Daily details for the last 30 days, separating the current cycle from earlier days.
- Warns when the weekly percentage is too low, when the data covers a whole workspace, or when a model has no price.
- Still shows the quota percentages when the account cannot read daily usage.

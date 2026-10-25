在 ChatGPT 的 **用量（Usage）页面**查看 Codex 额度窗口，按 OpenAI 官方费率把各模型的 Token 用量折算成美元，并估算本周还剩多少额度（折合美元）。

## 功能

- 5 小时窗口和周窗口的剩余比例、重置时间
- 周额度估值、剩余额度、本周期已消耗金额
- 按模型、速度档位、使用来源（Desktop / CLI / Plugin / Web / 其他）拆分金额
- 最近 30 天的每日明细，区分本周期和之前的日子
- 结果可能不准时给出提示
- 跟随 ChatGPT 深色 / 浅色主题

## 使用

打开 `https://chatgpt.com/settings/usage`，点击右下角的 **🧭 Codex 额度估算**。面板只在打开时和点击 ↻ 时读取数据。

## 隐私

- 只请求 chatgpt.com 自己的接口，使用你当前的登录状态。
- 数据只在浏览器内处理，不发送给任何第三方，也不写入本地存储。
- `@grant none`，代码未混淆。

## 注意

本脚本不是 OpenAI 官方工具，依赖未公开接口，可能随时失效。周额度估值是根据「已消耗金额 ÷ 已用百分比」推算的，只能作为大致参考。工作区里有其他人使用时，估值会偏高。

完整说明、计算方法和局限性见 GitHub：https://github.com/Cailishy/codex-quota-estimate

---

Shows your Codex quota windows on ChatGPT's Usage page, converts per-model token usage to USD at OpenAI's official rates, and estimates the weekly allowance left. Data is processed only in your browser and never sent to third parties. Not affiliated with OpenAI. The UI is in Chinese. Full documentation: https://github.com/Cailishy/codex-quota-estimate

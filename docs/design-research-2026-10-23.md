# 设计依据与落地检查 · 2026-10-23

目标不是添加装饰，而是让安装者不看教程也知道下一步；连接后立即找到工作与需要本人处理的问题。参考用户截图仅作为完成度基准，未沿用其主题、配色或字体。

## 本轮查阅的一手来源

- [Tailscale web client: login-toggle.tsx](https://github.com/tailscale/tailscale/blob/main/client/web/src/components/login-toggle.tsx) 与 [auth.ts](https://github.com/tailscale/tailscale/blob/main/client/web/src/hooks/auth.ts)：把只读、未登录、已授权等真实状态分别处理；外部登录完成后刷新产品状态。借鉴状态分层与“需要本人时才显示动作”，未复制其代码或调用自己的不存在的OAuth接口。
- [GitHub Primer Blankslate](https://primer.style/product/components/blankslate/)：空状态说明为何暂无内容，提供一个主要动作，次要帮助不抢占。落地为「连接我的 Dot」，而非同时展示服务离线、端口、五步说明和多个同权按钮。
- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)：常用任务先呈现，低频高级选项后置。落地为任务/当前授权在主区域，服务路径、端口和运维信息在可展开诊断中。
- [Radix Primitives: Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)：控件语义、标签、键盘行为与焦点同样属于可用性。落地为原生button、命名tablist、方向键切换、可见焦点、状态文字、减少动态效果。没有为了外观额外打包第二套React或组件运行时。

## 具体设计判断

- 身份：任务调度工具。雾白/石墨基础色、单一信号蓝、system sans、细分隔线、克制的容器，不借用家庭助手的绿色和衬线字。
- 第一次打开：一句说明、一个连接按钮、三阶段进度；首次尚未连接是中性状态，不显示成服务故障，也不提供无意义的暂停接入。
- 等待时：准确显示当前是登录、目标范围、创建专用权限还是连接授权；打开原窗口、取消与重试不会成为猜测。
- 已连接：任务进展和结果优先，状态小而准确；窄屏同样先显示任务，示例放后面。通道健康、账号连接与真实任务完成分别核实。
- 失败时：保留配置和上一次成功数据，只重试当前步骤；不复制粘贴密钥，不清空已有任务，不用旧成功记录冒充当前可用。

## 验收边界

共享React组件的合成预览、原生Host加载、官方表单结构和真实新用户登录链路分别验收。界面美观不能证明后端连接可用；测试中的合成任务不能记为真实Dot完成。具体证据和未覆盖环节记录在verification.md及本轮交付记录。

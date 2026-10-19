# Bloodboard Unified 0.2.0 公开源码

- [在线游戏](https://bloodboard-match.onrender.com/)
- [游戏与球探统一入口](https://bloodboard-hub.dd-bb1.chatgpt.site/)
- [六维球探源码](https://github.com/YDD060404/blood-bowl-scout-public)

这是当前 Unified 产品的干净源码快照，包括游戏引擎、浏览器/联机服务器、原生宿主、AI源码、构建脚本与合成测试。原始完整版本历史另外保存在私有备份中。

公开版排除了真实私人对局夹具、部署/本机验证记录与个人来源文件。少数历史回放测试依赖这些私有夹具，因此不能将其作为公开版完整测试套件运行；构建、类型检查和network测试不依赖这些私人文件。构建原生宿主时桥接依赖默认从online/node_modules读取，也可用--bridge-modules指定。

今后已验收的产品更新须同步在线部署、此公开源码库与私有完整备份，核对部署版本和远端提交；不公开凭据或私人用户记录。

---

# Bloodboard Unified 0.2.0

A shared core for the Mac app, standalone browser, hosted multiplayer and Match Lab. It combines Online 0.1.10 repairs/UI with the accepted local exact ball-chain and canonical-key optimizations.

## Run the browser version

With Node.js 18 or newer, run `npm ci`, `npm run build`, then `npm start`. Open the local address shown by the server. The compiled `dist/web` folder also runs as a standalone offline game. Hosted multiplayer: https://bloodboard-match.onrender.com/ (check its served build-info for deployment status).

Bundled coaches: Balanced, frozen Hopeful 1.5.9, and Hopeful S4.37U. Imported coaches and local saves are retained. S4.37U adds explicit compatibility with this core; it preserves the original TRAIN receipts and weights. No new strength claim is made.

## Build and verify

`npm run typecheck`; `ESBUILD=./node_modules/.bin/esbuild BB_TEST_CONCURRENCY=1 node scripts/run-tests.mjs`; `npm run test:network`. Browser acceptance scripts and the separately recorded release report cover UI/network behavior. `scripts/build-unified-hosts.mjs` assembles a new Mac app and same-source Match Lab without installing it. See RELEASE_NOTES_0.2.0.md.

## Upgrade and rollback

Keep the old app/release folder as rollback. Do not clear browser storage, delete native Teams/Positions/Settings, or reset hosted room journals. Update all network clients to the same rules hash. Existing histories may be labelled as other rules code; this is an honest fingerprint change. Finish any active hosted match before deploying a different core.

The public friend package contains runtime files only. Private source, real match fixtures, credentials and historical experiments are excluded. This unofficial personal tool is not affiliated with Games Workshop.

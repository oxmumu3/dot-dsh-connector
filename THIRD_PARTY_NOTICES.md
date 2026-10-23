# Third-party notices and provenance

This community connector is by 奥克斯木木山. It is not an official OpenAI, DeepSeek, or upstream-author product.

## Direct dependencies

- @modelcontextprotocol/sdk 1.32.1, official Model Context Protocol TypeScript SDK, MIT. Source: https://github.com/modelcontextprotocol/typescript-sdk . Distributed via npm; exact integrity and transitive versions are pinned in package-lock.json and the distributed npm-shrinkwrap.json. Full MIT license: third-party-licenses/modelcontextprotocol-sdk.txt.
- playwright-core 1.64.1, Apache-2.0. Source: https://github.com/microsoft/playwright . The exact npm integrity is pinned in both locks. Full license, NOTICE and transitive notices: third-party-licenses/playwright-core*.txt. Its optional first-connect browser is downloaded from the official Playwright distribution into an isolated private directory, never copied from a daily browser profile. Browser binaries are not in the plugin archive.
- zod 4.6.7, MIT. Source: https://github.com/colinhacks/zod . Exact npm integrity is pinned in package-lock.json and the distributed npm-shrinkwrap.json; full license: third-party-licenses/zod.txt.
- DSH host peer @deepseek-ai/dsh-llm 0.2.1-rc.2, with public agent, tools and session APIs supplied by the same host. Source: https://github.com/deepseek-ai/deepseek-harness . Not bundled or copied. The host's own license applies.

## Related local project and upstream research

DSH/dsh-project-companion 0.3.0-preview.1 was read for public host API patterns and result-correlation failure cases. This connector's source was independently implemented; no companion/vendor modules or WeChat transport, identity, credentials or data were copied.

That sibling's full provenance is preserved in its THIRD_PARTY_NOTICES.md: pan17/dsh-wechat at 8f163ed028ad96f33cfe5591e8201567d27ddf28 (MIT), hanshanyike/dsh-yolo 0.5.0 at c87d70105f975d86c5c0f98f34fbce66657a6934 (MIT), john-walks-slow/dsh-proactive 0.3.1 research commit 7a959839f6486aa521e6024a67425b33f098aa0b (MIT). None of their code is bundled in this connector. No claim is made to their authorship, transport or scheduling capabilities.

If vendoring any dependency in a future release, include the corresponding full copyright and license text in that distribution. This release uses package manager dependencies, not a vendored dependency tree.

## Native management UI development

The thin management plugin depends on public `@deepseek-ai/dsh-typert-protocol`0.2.1-rc.2 and the existing DSH shared client module/React18 interfaces; no installed SDK source or second React runtime is bundled in its archive. React18.2.0, React DOM18.2.0 and react-test-renderer18.2.0 are development-only test/preview dependencies under their MIT licenses. Their upstream package license files remain in npm distributions; the production connector archive excludes node_modules.
